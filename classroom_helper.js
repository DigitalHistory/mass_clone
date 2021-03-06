//////////////////////////
// require modules etc. //
//////////////////////////

const envFile = "/home/matt/DH/.env",
      shell = require('shelljs'),
      fs = require('fs'), path = require('path'),
      git = require('nodegit-kit'),
      jsonfile = require('jsonfile'),
      {GitProcess, GitError, IGitResult} = require('dugite');


const {Octokit} = require('@octokit/rest'),
      dotenv = require ('dotenv').config({path: envFile}),
      ghu = process.env.githubUsername,
      ghp = process.env.githubPassword,
      org = process.env.githubOrganization,
      token = process.env.ghOauth,
      ng = require('nodegit');

let  GP = GitProcess;

//might need to move this out elsewhere so I can
// initialize the octokit object somehow (!)
let octokit;

octokit = new Octokit({auth:"token" + token})

function initOcto (token) {
  octokit =   new Octokit(
    {auth: "token " + token}
  );
}


function cl (o) {
  console.log(JSON.stringify(o));
}


/////////////////////////////
// Old multi-repo workflow //
/////////////////////////////


function branchAndPR (localpath, ghowner, ghrepo, base, head) {
  /** I had the idea of extracting some logic for individual branching operations to make it
      easier to do one-off regrades/resubmits. But I'm not quite sure what the right granularity level is
      so for now this does nothing :-/
  */
  
  console.log(`creating branch `);
}


/**
 * create a new branch NEWBRANCH in REPO, owned by OWNER, branching at OLDREF
 * 
 * @param {string} owner
 * @param {sring} repo
 * @param {string} newbranch
 * @param {string} oldref
 */

async function makeBranch (owner, repo, newbranch, oldref)   {
  let newRef;
  try {
  newRef = await octokit.gitdata.createReference({
    owner:  owner,
    repo: repo,
    ref: `refs/heads/${newbranch}`,
    sha: oldref
  });
  } catch (e) {
    if (JSON.parse(e.message).message == 'Reference already exists' ) {
      return true;
    } else {
      console.log(JSON.parse(e.message).message);
      return false;
    }
  } 
  return newRef;
}

/**
 * create pull request in REPO belonging to OWNER from HEAD onto BASE w/ TITLE and BODY
 * @param {} owner
 * @param {} repo
 * @param {} head
 * @param {} base
 * @param {} title
 * @param {} body
 */
async function makePR (owner, repo, head, base, title, body = '') {
  // would be nice to return an existing PR if this fails 
  let result;
  try {
    result = await octokit.pullRequests.create(
      {owner: owner,
       repo: repo,
       head: head,
       base: base,
       title: title,
       body: body});
  } catch(e) {
    // e.message will be a string whose content is valid JSON
    // so we can parse it with, e.g., JSON.parse(e.message)
    // the "message" attribute of this JSON blob may or may not be helpful
    // but e.g. JSON.parse(e.message).errors will be a list, usually with 1 member,
    // which will be an object with a 'message' attribute whose content may be
    // "No commits between ${base} and ${head}" or
    // "A pull request already exists for ${owner}:${head}"
    // would be nice to do something with these particular error types
    // e.g., at least if the PR already exists, we could get that PR object back

    // e.g.:
    let allErrs = JSON.parse(e.message).errors;
    for (let i of allErrs) {
      console.log(i.message);
      if (i.message.includes("A pull request already exists")) {
        console.log ("YES, EXISTS")
        try {
          const allPRs = await octokit.pullRequests.getAll({
            owner: owner,
            repo: repo,
            head: head,
            base: base
          });
          console.log(allPRs.data[0]);
          return allPRs.data[0];
        } catch (innerError) {
          console.log(`Tried to get existing PR but ended up with error: ${innerError}.`);
          return undefined;
        }
      } else {
        console.log(e);}
    }
    //console.log(e);
    result= e;
  }
  return result.data;
}


function makeSubmissionBranches (assign,  baseDir, mainBranch = "master", comments="teacher-comments", submission='submission') {
  /**
   * given an assignment object and a base directory, cd to the base directory and
   * iterate across all git repositories, creating both a "teacher-comments" branch and
   * a "subission" branch. Then push both branches to Github &  create a github PR
   * comparing them. Preserve the PR URL for later use.
   *
   * Should be updated to separate branch creation from PR creation, b/c the former requires
   * shell while the latter can be done w/ octokit.  A separate function therefore makes sense.  
   */
  shell.cd (baseDir + assign.basename);
  var listing = shell.ls();
  for (i of listing) {
    let p = baseDir + assign.basename + "/" + i;
    console.log(`\n\n**   INSIDE ${i}   **\n`);
    console.log(`Making branches for ${p}`);
    if (fs.lstatSync(p).isDirectory() && i.indexOf(assign.basename) != -1  && i != assign.basename) {
      shell.cd(i);
      console.log(`cding to ${i} to attempt ${comments} branch`);
      shell.exec(`git branch ${comments} ${assign.teacherCommit}`);
      shell.exec(`git fetch && git checkout --track origin/${mainBranch} || git checkout ${mainBranch}`)
      var lastGoodCommit = shell.exec(`git rev-list --before=${assign.deadline} -n 1 ${mainBranch}`).stdout.slice(0,-1);
      console.log(`attempting to branch ${submission} from commit number ${lastGoodCommit}`)
      shell.exec(`git checkout -b ${submission} ${lastGoodCommit}`);
      console.log('pushing branches & creating PR');
      shell.exec(`git push origin ${submission}; git push origin ${comments}; 
hub pull-request -h ${submission} -b ${comments} -m "comments on your assignment" >> ../pull-request-list.txt`);
      // convert to makePR - -but this requires using git to extract the repo name
      // for this we'll need nodegit, I think.
      // var r = new RegExp('github.com:(.*)/(.*).git');
      
      //makePR (org, )
      shell.cd ("..");
    }
  }
}

async function updateSubmissionBranch (repo, head, submission = 'submission') {
  const result = await octokit.repos.merge(
    {owner: 'DigitalHistory',
     repo: repo,
     base: submission,
     head: head,
     commit_message: `updating submissiont branch ${submission} with commits from ${head}.`});
  return result;
}


// function makeBranches (assign, baseDir, newBran)

function makeResubmitBranch (assign,  baseDir, studentID, resubNum ) {
  /**
   * Given an assignment object, a base directory, a student Github ID, and
   * the "number" of the resubmission (first, second, third), fetch that branch
   * from the appropriate remote repo & create a PR against teacher-comments.
   * It might be best actually, in future, to create a PR against the initial submission.
   */
  let p = baseDir + assign.basename + "/" + assign.basename + "-" + studentID;
  if (fs.lstatSync(p).isDirectory()  ) {
    shell.cd(p);
    console.log(`cding to ${p} to make new PR branch`);
    //shell.exec(`git branch teacher-comments ${assign.teacherCommit}`)
    // var lastGoodCommit = shell.exec(`git rev-list --before=${assign.deadline} -n 1 master`).stdout.slice(0,-1);
    // console.log(`attempting to branch  from commit number ${lastGoodCommit}`)
    //shell.exec(`git branch submission ${lastGoodCommit}`);
    shell.exec(`git checkout --track origin/resubmit-${resubNum}`);
    //hub pull-request 
    shell.exec(`hub pull-request -h resubmit-${resubNum} -b teacher-comments -m "comments on resubmission #${resubNum}" >> ../pull-request-resubmit-list.txt`);
    shell.cd ("..");
    
  }
}


async function makeResubmitPRs (assignment, org, baseDir, comments='teacher-comments', addRE) {
  /*
   * given an assignment object, an organization name, and a base direcotry
   * find all the existing resubmission branches, then iterate through them
   * and create PR's from the resubmission to the teacher-comments.
   * Then navigate to the local directory and check out the resubmisison branch
   * in preparation for marking.
   *
   * Brittly assumes the existence of the local repo, and does no error checking
   * on the PR. Could be massively improved, though checking for pre-existence of PR
   * will have substantial speed cost with little functionality gain. 
   */
  var resubs = await findResubmitBranches (org, assignment);
  //console.log(resubs);
  for (b of resubs) {
    if (addRE && b.branch.includes(addRE)) {
      let prData = await makePR(org, b.repo, b.branch, comments,
                                `Comments on your resubmisison branch ${b.branch}`);
      console.log(`\n\n**  making pr for b.repo   WITH ${prData}**\n`)
      shell.cd(baseDir + assignment.basename + "/" + b.repo);
      shell.exec(`git fetch && git checkout ${b.branch}`);
      if (prData ) {
        shell.exec(`echo "${prData.url}" >> ../resubmit-prs.txt`);
      } else {
        console.log(`Unable to create PR from ${b.branch} to ${comments} in REPO: ${b.repo}.\n\n`)
      }      
    }
  }
}


function runTests(assign, baseDir) {
  /**
   * Given an assignment object and a base directory, run tests in all student repos
   * inside the base directory.
   */
  shell.cd (baseDir + assign.basename);
  console.log("\n\n ** running all tests in " + shell.pwd());
  var listing = shell.ls();
  //console.log(listing);
  for (i of listing) {
    let p = baseDir + assign.basename + "/" + i;
    console.log(`\n\n * TESTS in ${i}`);
    if (i.indexOf(assign.basename) != -1 && fs.statSync(p).isDirectory()) {
      shell.cd (i)
      shell.exec("npm install && npm test &");
      shell.cd ("..");
      // shell.exec
    }
  }
}

async function cloneRepos (assign, org, user, protocol, baseDir) {
  /**
   * Given an assignment object, and organization, a user, a protocol a base direcotry,
   * and a github password (!), clone all student repos for the assignment into a direcotry
   * *inside of* the base directory.
   *
   * It would be better to just define a github authentication object ocnsisting of
   * protocol, username, token/password, whatever.
   * but that is more difficult to do with a dotenv file. 
   */
  console.log('inside clonerepos')
  shell.mkdir('-p', baseDir + assign.basename);
  shell.cd (baseDir + assign.basename);
  shell.exec(`git clone ${assign.upstream} ${baseDir}${assign.basename}/${assign.basename} `);
  
  console.log("Beginning mass clone in directory " + process.cwd());
  const result = await octokit.paginate('GET /orgs/:org/repos', {org: org} );
  console.log(result);
  let counter = 0;
  for (d of result) {
    let match = d.name.indexOf(assign.basename);
    // console.log (match);
    if (match  != -1) {
      if (d.name === assign.basename ) {
        shell.exec(`git clone ${d.ssh_url} ${baseDir}${assign.basename}/${assign.basename} `);
        continue;
      }
       console.log(d.name);
      
      let student = d.name.substr(match + 1 + assign.basename.length);
      // console.log(d.clone_url);
      // console.log(process.cwd())
      shell.exec(`git clone ${d.ssh_url} ${baseDir}${assign.basename}/${student} `);
      counter += 1;
    }
  }
  console.log("there are this many repos: " + counter);
  
}


function testAndReport (assign, baseDir, outputFile = 'testresults.json') {
  let repos = getDirectories(path.join(baseDir, assign.basename)),
      results = [];
  shell.cd (baseDir + assign.basename);
  shell.cd (assign.basename);
  // shell.exec(`npm install`);
  shell.cd ("..");
  for (r of repos ) {
    if (path.basename(r) === assign.basename) {
      continue
    }
    // console.log("about to cd")
    shell.cd(r) ;
    let id = path.basename(r);
    console.log(id);
    let o = {github: id };
    
    o.tests = 1,


    o.reflection = 1;
    if ( shell.exec(assign.mainTests + ">> /dev/null" ).code > 0) { o.tests = 0; }
    if ( shell.exec(assign.reflectionTests  + ">> /dev/null" ).code > 0) { o.reflection = 0; }
    // console.log(code);
    results.push(o);
    
  }
  console.log(JSON.stringify(results));
  
  jsonfile.writeFile(path.join(baseDir, assign.basename, outputFile),
                     results, function(err) {console.log(err);});
  return results;
}

// slated for replacement by 
function cloneAndUpdate (assign, org,  baseDir, upstream, gitref, mainBranch = "master") {
  /**
   * given an assignment, an org, a baseDir, an upstream repo, and a git reference
   * (branch or commit) clone all assignment repos, checkout master, merge changes
   * from upstream, and push to origin
   */
  // cloneRepos(assign, org, null, null, baseDir, null);
    shell.cd (baseDir + assign.basename);
  var listing = shell.ls();
  for (i of listing) {
    let p = baseDir + assign.basename + "/" + i;
    console.log(`Making changes for ${p}`);
    if (fs.lstatSync(p).isDirectory() && i.indexOf(assign.basename) != -1 ) {
      shell.cd(i);
      console.log("adding remote");
      shell.exec(`git remote add upstream  ${upstream} && git fetch upstream `);
      console.log("merging");
      shell.exec(`git merge upstream/${mainBranch}`);
      // shell.exec(`git push origin submission; git push origin teacher-comments; hub pull-request -h submission -b teacher-comments -m "comments on your assignment" >> ../pull-request-list.txt`);
      // convert to makePR - -but this requires using git to extract the repo name
      // for this we'll need nodegit, I think.
      // var r = new RegExp('github.com:(.*)/(.*).git');
      
      //makePR (org, )
      shell.cd ("..");
    }
  }
}


/////////////////////////////////////////////
// Begin New Workflow                      //
// Little Above this line matters anymore! //
/////////////////////////////////////////////


//TODO: remove idiotic parameters
/**
 * Returns an array of all repos matching the assignment basename.
 * Each element of the array wil lbe an object with the fields `name`, 
 * `url`, and `student`
 * @param {string} assign
 * @param {string} org
 * @param {string} user: unused, should beremoved. 
 * @returns {array} 
 */
async function getRepos (assign, org, user) {
  /**
   * ignores everything except `org` and `assign`. 
   * but that is more difficult to do with a dotenv file. 
   */
  //console.log('inside getrepos')

  const apiResult = await octokit.paginate('GET /orgs/:org/repos', {org: org} );
  
  let counter = 0,
      data = [];  
  for (d of apiResult) {
    let match = d.name.indexOf(assign.basename);
    // console.log (match);
    if (match  != -1) {
      if (d.name === assign.basename ) {
        continue;
      }
      let student = d.name.substr(match + 1 + assign.basename.length);
      data.push({name: d.name, url: d.ssh_url, student: student});
      counter += 1;
    }
  }
  return data;
}


/**
 * Adds all matching student assignments as remotes and creates a tracking branch for each one.
 * @param {object} assign
 * @param {string} org
 * @param {string} user
 */
async function getAllAsBranches (assign,org,user ) {
  const repos = await getRepos (assign, org, user);
  cl(repos);
  // this is taken care of by getrepos,reight? 
  for (let r of repos) {
    if (d.name === assign.basename) {
      continue }
    let url = r.url;
    let id = r.name.substr(assign.basename.length + 1);

    // cl(`URL AND ID: ${url} ${id}`)
    console.log(`about to add remote ${url} for ${assign} user ${id}`);
    await addRemoteasBranch(assign, url, id );
    // await GP.exec(['checkout', `${id}-${mainBranch}`]);
    // testData.push (await testAndReportBranch (assign, `${id}-master`, id));
  }
}

async function createRemote (assign, remoteUrl, remoteName) {
  console.log(`createing remote ${remoteName}`);
  shell.exec(`git remote add ${remoteName} ${remoteUrl}`);
  shell.exec(`git fetch ${remoteName}`);
  
  // GP.exec(['branch', '-a']).
  //   then  (async ( {stdout })  => {
  //     //cl(stdout);
  //     let re = new RegExp(`remotes\/${remoteName}`);
  //     if (! stdout.match(re)) {
  //       await GP.exec(['remote', 'add', remoteName, remoteUrl] ).
  //         catch((err) => {cl (`Add failed w/ ${err}`); });
  //     }
  //   }).
  //   then(async ( ) => {fetch =  await GP.exec(['fetch', remoteName]) });
};

async function createTrackingBranch(assign, remoteName, branchName, mainBranch = "master") {
  // cl([remoteName, branchName]);
  let branchExists = shell.exec(`git show-ref --verify --quiet refs/heads${branchName}`).code,
      base = assign.basename,
      result =  branchExists ?  shell.exec(`git fetch ${remoteName } ; git checkout -b ${branchName} ${remoteName}/${mainBranch}`) :
      shell.exec(`git checkout ${branchName} && git pull`);

  //cl(result);
  return result;
}



/**
 * Synchronously run tests on all branches and report back with results;
 * @param {} assign
 * @param {} basedir
 * @param {array} branchlist
 * @returns {} 
 */
function testAllBranches (assign, basedir, branchList, mainBranch = "master") {
  testData = [];
  let branchRE = new RegExp("([A-Za-z0-9_-]+)-" + mainBranch)
  for (let b of branchList) {
    let id = b.match(branchRE) ?
        b.match(branchRE)[1] : null;
    if (id) {
      testData.push(testAndReportBranchSync(assign, b, id));
    }
  }
  
  return testData;
}


//TODO: remove idiotic parameters
function getReposAndUpdate (assign, org, user,  files, push, mainBranch="master") {
  /**
   * much simplified.  Must be executed from within the repo.  
   * baseDir is ignored. protocol is ignored.
   * retrieve a list of repos
   * then pull them in, and add extra commits
   * amending any files that need to be pulled from my local
   * development branch of the repo
   * usually thiswill be only test/test.js and package.json at most
   * hopefully often not even that.
   * Can also be used to push out latbreaking changes that I screwed up
   */
  console.log(`update repos with these files: ${JSON.stringify(files)}!`);
  
  getRepos (assign, org, user).
    then ( (result ) => {
      for (d of result) {
         let match = d.name.indexOf(assign.basename);
        if (match  != -1) {
          if (d.name === assign.basename ) {
            continue;
          }
          //TODO: take out this protective `if`
          //if (d.name.indexOf(ghu) != -1) {
          console.log(d.name);
          let url = d.url,
              id = d.name.substr(assign.basename.length + 1),
              branchName = `id-${mainBranch}`;
          console.log(`Updating repo ${d.name}`);
          //not usng this
          let pathToRepo = "./";
          // cl([url, id, files,pathToRepo]);
          createRemote(assign, url, id).
            then ( async () => {
              return createTrackingBranch(assign, id, branchName);
            }).
            then( ( ) => {
              cl(`about to update branch ${id}-${mainBranch}`)
              return updateRemoteFromMaster(assign, url, id, files, push);
            })
            .catch( (err) => { return err; });
          //}
          //let student = d.name.substr(match + 1 + assign.basename.length);
        }
      }
    } ); 
  //console.log("there are this many repos: " + counter);
}


/**
 * Add a remote and create new tracking branch to its `master`
 * @param {Obj} assign
 * @param {String} remoteUrl
 * @param {String} remoteName
 * @returns {} 
 */
async function addRemoteasBranch (assign, remoteUrl, remoteName, mainBranch = "master") {
  let localBranch = `remoteName-${mainBranch}`,
      GP = GitProcess,
      localExists = await GP.exec(['rev-parse', '--quiet', '--verify', localBranch] );
  // replace these w new functions

  if (localExists.exitCode > 0) {

    createRemote (assign, remoteUrl, remoteName).
      then ( () => { createTrackingBranch (assign, remoteName, localBranch)  }
             // GP.exec(['remote', 'add', remoteName, remoteUrl] ).
           ).
      // then ( ( ) => {GP.exec(['fetch', remoteName]); }).
    // then( ( ) => {GP.exec(['checkout', '-b', localBranch, `${remoteName}/master`]) ;} ).
    catch (function (err) {console.log(`Add  ${remoteName} failed with ${err}`);
                           return err;});
  } else {console.log(`branch ${localBranch} already exists, not creating.`);}
}

////////////////////////////////////////
// aync functions using native git to //
// update branches with files         //
////////////////////////////////////////

/**
 * query the assignment and get a list of branches
 * @param {} assign assingment object
 * @param {string} basedir root directory i nwhich to find repo
 * @returns {array} an array of all branch names
 */
async function getAllBranches (assign, basedir) {
  let repo = await ng.Repository.open(path.join(basedir, assign.cloneAs)),
      result = await repo.getReferenceNames(ng.Reference.TYPE.LISTALL).
      then ((names) => {
        let a = names.filter(function (str) { return str.includes("refs/heads"); })
        a.forEach(function(part, index) {
          this[index] = this[index].substr(11)
        }, a);
        return a;
      });
  return result;
};

async function updateFilesAllBranchesLocal (assign,basedir, files, branches, mainBranch="master") {
  branches = branches ? branches:  await getAllBranches (assign, basedir);
  let localCopy = assign.devDir;
  // console.error('IN UPDATEFILESLOCAL')
  shell.exec(`git stash; git checkout ${mainBranch}`);
  for (f of files) {
    cl(`committing ${f} in ${mainBranch}`);
    shell.exec(`cp ${localCopy}/${f} ${f} ; git add ${f}; git status; git commit  -m "add ${f} from master"`)
  }
  for (b of branches) {
    for (f of files) {
      let diffExists = await GitProcess.exec(['diff', b, mainBranch, '--exit-code', '--', f]);
      if ( diffExists.exitCode > 0 ) {
        cl(`committing ${f} in ${b}`);
        shell.exec(`git stash; git checkout ${b}; git checkout ${mainBranch} -- ${f}; git commit -a -m "add ${f} from master"; git checkout master`);
      } else {console.log(`no diff between ${mainBranch} and ${b}, won't commit`);}
    }
  }
}

async function updateFilesAllBranches (assign,basedir, files, branches, mainBranch='master') {
  branches = branches ? branches:  await getAllBranches (assign, basedir);
  for (b of branches) {
    for (f of files) {
      cl(`committing ${f}} in ${b}`);
      shell.exec(`git stash; git checkout ${b}; git checkout ${mainBranch} -- ${f}; git commit -a -m "add ${f} from ${mainBranch}"; git checkout master`)
    }
  }
}


/**
 * pushes all changes on all branches to default remotes
 * @param {object} assign
 * @param {string} basedir: root directory in which to find gitrepo
 */
async function pushAllBranches (assign, basedir) {
  let branches = await getAllBranches (assign, basedir);
  for (b of branches) {
    shell.exec(`git checkout ${b} && git push `);
  }
}

/**
 * update BRANCH with FILES from master
 * @param {string} branch 
 * @param {array} files
 */
async function updateBranchFiles (branch, files, mainBranch=`master`) {
  for (f of files) {
    shell.exec(`git stash; git checkout ${branch}; git checkout ${mainBranch} -- ${f}; git commit -a -m "add ${f} from master"; git checkout master`)
  }
}

/**
 * Delete remote and local tracking branch
 * @param {object} assign
 * @param {string} remoteName
 * @param {string} trackingBranch
 * @returns {iGitresult} 
 */
async function deleteRemoteandBranch (assign, remoteName, trackingBranch, mainBranch = `master` ) {
  return GP.exec([ 'checkout',  mainBranch]).
    then( ( ) => {return GP.exec([ 'branch',  '-D', `${localBranch}`]) }).
    then( ( ) => {return GP.exec([ 'remote',  'remove', `${remoteName}`]);});
}

// only works if you're in yourrepository! new workflow
//TODO fix assignment oops!

/**
 * Having a lot of trouble with tis functin, which is supposed to
 * update all branches and optionally push toremotes. but can't get
 * async code to work in what is fundamentally a synchronous process
 * @param {object} assign
 * @param {string} basedir
 * @param {string} remoteUrl
 * @param {string} remoteName
 * @param {array} files
 * @param {boolean} push
 * @returns {iGitresult} 
 */
function updateRemoteFromMaster (assign, basedir, remoteUrl,  remoteName, files, push, mainBranch = 'master'){
  let localBranch = `remoteName-${mainBranch}`,
      GP = GitProcess;
  createRemote(assign, remoteUrl, remoteName).
    then( ( ) => {createTrackingBranch(assign, remoteName, localBranch) }).
    then( ( ) => {
      updateBranchFiles (localBranch, files);
    }).
    then( ( ) => {
      if (push) {
        GP.exec([ 'push',  remoteName,  `${localBranch}:$mainBranch`]).
          then( ( ) => {return deleteRemoteandBranch(assign, remoteName, localBranch) });
    } })
}





const isDirectory = source => fs.lstatSync(source).isDirectory()
const getDirectories = source =>
      fs.readdirSync(source).map(name => path.join(source, name)).filter(isDirectory)
/**
 * Given an assignment object, run `npm install` in the upstream repo and 
 * then symlink in all the other dirs.
 * @param {} assign
 * @param {} baseDir
 */
function installAndLink (assign, baseDir) {
  shell.cd (baseDir + assign.basename);
  
  shell.cd (assign.basename);
  shell.exec(`npm install`);
  shell.cd ("..");
  let repos = getDirectories(path.join(baseDir, assign.basename));
  for (r of repos ) {
    shell.cd(r) ;
    shell.exec(`ln -s ../${assign.basename}/node_modules ./` )
  }
  
  
}

/**
 * Synchronously (!) checkout and test each studnt branch, collet results return
 * @param {object} assign
 * @param {string} branch
 * @param {string} studentid
 * @returns {object} 
 */
function testAndReportBranchSync (assign, branch, studentid) {
  let o = {github: studentid, tests: 0, reflection: 0 };
  shell.exec(`git checkout ${branch}`);
  // record main tests
  if ( shell.exec(assign.mainTests + ">> /dev/null" ).code == 0) {
    o.tests = 1; }
  //record ref tests
  if ( assign.reflectionTests && shell.exec(assign.reflectionTests  + ">> /dev/null" ).code == 0) {
    o.reflection = 1; }
  cl(o)
  // but commit ALL tests to repo
  assign.allTests && shell.exec(assign.mainTests + ">> /dev/null" )  ;
  shell.exec(`git add -f TestResults/testresults.html && git commit -m "Add testresults.html on ${branch}"`);
  shell.exec(`git stash push --include-untracked -m "Stashing all from ${branch} after testing"`);
  return o;
}

async function testAndReportBranch (assign, branch, id) {
  /**
   * assumes we are already in the right repo.  
   **/
  // console.log(id);
  let o = {github: id, tests: 0, reflection: 0 };
  return GP.exec(['checkout', branch]).
    then( () => {
      // record results of main tests
      if ( shell.exec(assign.mainTests + ">> /dev/null" ).code == 0) {
        o.tests = 1; }
      //record ref tests
      if ( assign.reflectionTests && shell.exec(assign.reflectionTests  + ">> /dev/null" ).code == 0) {
        o.reflection = 1; }
      // but commit all tests
      cl(o)
      return assign.allTests && shell.exec(assign.mainTests + ">> /dev/null" )  ;
    }).
    then( () => {
      cl(`seem to have checked out and run tests.`);
      return GP.exec(['add', '-f', 'TestResults/testresults.html']);  }).
    then( (res) => {
      // cl(res) ;
      return GP.exec(['commit', '-m', `"Add testresults.html on ${branch}"`]).
        then (
          ({ stdout, stderr}) => {
        // cl(`commit results: ${stdout}, ${stderr}`));
          });
    }).
    then  ( () => {  GP.exec(['stash', 'push', '--include-untracked', '-m', `"Stashing changes brought about by testing on ${branch}"` ]).
                     then( ( {stdout, stderr} ) => {
                       //cl(`Stashing ${branch} changes\n stdout:${stdout} \nstderr: ${stderr}`)
                     }); }).
    catch(function (err) {
       console.log(`oops! ${err}`);
    } ) ;
  return o;
}


/**
 * obsolete with new octokit auth procedure
 * @param {} user
 * @param {} pw
 */
function authenticateGH (user, pw) {
  /**
   * Just a simple authentication function. 
   */

  octokit.authenticate({
    type: 'basic',
    username: user,
    password: pw
  });
}

async function makePR (org, repo, head, base, title, body) {
  try {
    const pr = await octokit.pullRequests.create(
      {owner: org,
       repo: repo,
       base: base,
       head: head,
       title: title,
       body: body
      });
    console.log (pr.data);
    return pr.data
  } catch (err) {
    console.log("Unable to create PR due to errpr: " + err.message );
  }
}

async function makeManyPRs (org, assignment, head, base, title="Comments on your assignment", body=null) {
  let repos = await paginateGHResults(octokit.repos.getForOrg, {org: org, per_page: 100});
  let count = 0;
  for (let r of repos) {
    if (r.name.indexOf(assignment.basename) != -1 && r.name != assignment.basename) {
      let branches = await octokit.repos.getBranches({owner: org, repo: r.name, per_page:100});
      let hashead = false;
      let hasbase = false;
      for (b of branches.data) {
        if (b.name == head ) {
          hashead = true;
        } else if (b.name == base) {
          hasbase =true;
        }
      }
      if (hashead && hasbase) {
        //makePR (org, r.name, head, base, title, body);
        console.log(`${r.name} DOES have head branch ${head} and base branch ${base}.`  );
      } else {
        console.log(`${r.name} does not have head branch ${head} and base branch ${base}.`  );
      }
      //console.log(branches);
      count += 1;
    }
  }
  console.log(count);
     //   .then(
    // data => {
    //   let counter = 0;
    //   for (d of data) {
    //     console.log (d.name.indexOf(assignment.basename));
    //     if (d.name.indexOf(assignment.basename) != -1) {
    //       console.log(d.name);
    //       // console.log(d.clone_url);
    //       // console.log(process.cwd())
    //       shell.exec(`git clone ${d.ssh_url} ${baseDir}${assign.basename}/${d.name}`);
    //       counter += 1;
    //     }
    //   }
    //   console.log("there are this many repos: " + counter); 
    // });
}

/**
 * can probably mostly bereplaced by octokit.paginate.  
 * @param {} method
 * @param {} args
 * @returns {} 
 */
async function paginateGHResults (method, args) {
  /**
   * Stolen from the octokit docs. An async function to retrieve all results from an
   * octokit query; a workaround for the github API's pagination mechanism. 
   */
  console.log ("Method is: " + method);
  const options = method.endpoint.merge(args);
  console.log(options);
  octokit.paginate(options)
    .then(data => {
      // console.log(data);
      // return data;
    })
  let d = await octokit.paginate(options);
  return d;
  // let response = await method(args);
  // let {data} = response
  // while (octokit.hasNextPage(response)) {
  //   response = await octokit.getNextPage(response)
  //   data = data.concat(response.data)
  // }
  // return data
}

async function findResubmitPRs (org, assign) {
/**
 * Given an org, find all repos with any kind of "resubmit" branch. Maybe would be nice
 * to order by date of creation or something. 
 */
  console.log("in resubmits");
  const allRepos = await paginateGHResults(octokit.repos.getForOrg, {org: org, per_page: 100});
  var myresult;
  
  for (r of allRepos) {
    if (r.name.includes(assign.basename)) {
      myresult = await octokit.pullRequests.getAll({owner: org, repo: r.name, per_page: 100});
      //console.log(myresult.data);
      for (p of myresult.data) {
        if (p.head.ref.indexOf("res") != -1){
          console.log(r.name + " " + p.head.ref + " PR url is: " + p.html_url );
          
        }
      }
    }
  }
}


async function findResubmitBranches (org, assignment) {
  /**
   * Given an org, find all repos with any kind of "resubmit" branch. Maybe would be nice
   * to order by date of creation or something. 
   */
  console.log("finding resubmit branches");
  const allRepos = await paginateGHResults(octokit.repos.getForOrg, {org: org, per_page: 100});
  
  var branches;
  var returnValue = [],
      outputFile = "./resubmits.json";
  
  for (r of allRepos) {
    // console.log(r);
    if (r.name.indexOf(assignment.basename) != -1) {
      branches = await octokit.repos.getBranches({owner: org, repo: r.name, per_page:100});
      for (b of branches.data) {
        //console.log(b);
        if (b.name.toLowerCase().indexOf("resub") != -1) {
          console.log (`Repo ${r.name} has a branch called ${b.name}`);
          let o = { repo: r.name, branch: b.name};
          returnValue.push(o);
        }
      }
    }
  }
  console.log(JSON.stringify(returnValue));
    jsonfile.writeFile(outputFile, returnValue, function(err) {console.log(err);});
  return returnValue;
}

// initialize the grading repo
function initGradingRepo (assign, baseDir = "/home/matt/src/") {
  if (! fs.existsSync (baseDir)) {
    fs.mkdirSync(baseDir);
  }
  if (! fs.existsSync (path.join (baseDir, assign.cloneAs))) {
    GP.exec(['clone', assign.upstream, assign.cloneAs], baseDir );}
  
  shell.cd(path.join (baseDir, assign.cloneAs));
  shell.exec(`git config push.default upstream`)
  shell.exec("npm install");
}

// makeResubmitBranch (assignment, defaultBasedir, "mahdic", 1);
async function test() {
// var myresult = await octokit.pullRequests.create({owner: "DigitalHistory", repo: 'assignment-01-html-css', head: 'master', base: 'add-testing', title: 'just testing octokit', body: 'no body to speak of'});
}

// exports

for (f of  [initOcto, makeBranch, makePR, makeManyPRs,
            makeSubmissionBranches, makeResubmitPRs,
            cloneAndUpdate, makePR, findResubmitPRs,
            findResubmitBranches, makeResubmitBranch,
            makeSubmissionBranches, authenticateGH,
            cloneRepos, runTests, paginateGHResults,
            installAndLink, testAndReport,
            getRepos, getReposAndUpdate,
            getAllAsBranches, initGradingRepo,
            getAllBranches, updateFilesAllBranches,
            pushAllBranches, testAllBranches]) {
  exports[f.name] = f;
}











