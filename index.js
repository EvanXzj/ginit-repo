#!/usr/bin/env node

'use strict'

const chalk       = require('chalk')
const clear       = require('clear')
const CLI         = require('clui')
const figlet      = require('figlet')
const inquirer    = require('inquirer')
const Preferences = require('preferences')
const Spinner     = CLI.Spinner
const GitHubApi   = require('github')
const _           = require('lodash')
const git         = require('simple-git')()
const touch       = require('touch')
const fs          = require('fs')
const util        = require('util')
const files       = require('./lib/files')

clear()
console.log(
    chalk.yellow(
        figlet.textSync('Ginit',{horizontalLayout:'full'})
    )
)

if(files.directoryExists('.git')){
    console.log(
        chalk.green('Already a git repository!')
    )
    process.exit()
}

var github = new GitHubApi({
    version: '3.0.0',
})

function getGithubCredentials(callback){
    let questions = [
        {
            name:'username',
            type:'input',
            message:'Enter your Github username or e-mail address:',
            validate:value => {
                return value.length ? true :'Please enter your username or e-mail address'
            }
        },
        {
            name:'password',
            type:'password',
            message:'Enter your password:',
            validate:value => {
                return value.length ? true : 'Please enter password'
            }
        }
    ]

    inquirer.prompt(questions).then(callback)
}

function getGithubToken(callback){
    let prefs = new Preferences('ginit')

    if(prefs.github && prefs.github.token){
        return callback(null,prefs.github.token)
    }

    getGithubCredentials(credentials => {
        let status = new Spinner('Authenticating you, please wait...')
        status.start()
        github.authenticate(
            _.extend(
                {
                    type:'basic'
                },
                credentials
            )
        )

        github.authorization.create({
            scopes: ['user', 'public_repo', 'repo', 'repo:status'],
            note: 'ginit, the command-line tool for initalizing Git repos'
        },(err,res) => {
            status.stop()
            if(err) return callback(err)
            if(res.data.token){
                prefs.github ={
                    token:res.data.token
                }
                return callback(null,res.data.token)
            }
            return callback()
        })
    })
}

function createRepo(callback){
    let argv = require('minimist')(process.argv.slice(2))
    console.log(
        chalk.red(argv)
    )

    let questions = [
        {
            type:'input',
            name:'name',
            message:'Enter a name for the repository:',
            default:argv._[0] || files.getCurrentDirectoryBase(),
            validate:value => {
                return value.length ? true : 'Please enter a name for the repository'
            },
        },
        {
           type:'input',
           name:'description',
           message:'Optionally enter a description of the repository:',
           default:argv._[1] || null,
        },
        {
            type:'list',
            name:'visibility',
            message:'Public or private:',
            choices:['public','private'],
            default:'public',
        }
    ]

    inquirer.prompt(questions).then(answers => {
        let status = new Spinner('Creating repository...')
        status.start()

        let data ={
            name:answers.name,
            description:answers.description,
            private: (answers.visibility === 'private'),
        }

        github.repos.create(data,(err,res) => {
            status.stop()
            if(err) {
                return callback(err)
            }
            return callback(null,res.data.ssh_url)
        })
    })
}

function createGitignore(callback){
    let filelists = _.without(fs.readdirSync('.'),'.git','.gitignore')
    console.log('filelists '+filelists)
    let questions = [
        {
            type:'checkbox',
            name:'ignore',
            message:'Select the files and/or folders you wish to ignore:',
            choices:filelists,
            default:['node_modules','bower_components']
        }
    ]

    if(filelists.length){
        inquirer.prompt(questions).then(answers => {
            if(answers.ignore.length){
                fs.writeFileSync('.gitignore',answers.ignore.join('\n'))
            }else{
                touch('.gitignore')
            }
            return callback()
        })
    }else{
        touch('.gitignore')
        return callback() 
    }
}

function setupRepo(url,callback){
    let status = new Spinner('Setting up the repository...')
    status.start()

    git
        .init()
        .add('.gitignore')
        .add('./*')
        .commit('Initial commit')
        .addRemote('origin',url)
        .push('origin','master')
        .then(() => {
            status.stop()
            return callback()
        })
}

function githubAuth(callback){
    getGithubToken((err,token) => {
        if(err) return callback(err)
        github.authenticate({
            type:'oauth',
            token:token
        })

        return callback(null, token)
    })
}

githubAuth((err,authed) => {
    if(err){
        switch (err.code) {
            case 401:
            console.log(chalk.red('Couldn\'t log you in. Please try again.'))
            break
            case 422:
            console.log(chalk.red('You already have an access token.'))
            break
        }
    }

    if(authed){
        console.log(chalk.green('Sucessfully authenticated!'))
        createRepo((err,url) => {
            if(err){
                console.log(chalk.red(`An error has occured:${err.message}`))
            }
            if(url){
                createGitignore(() => {
                    setupRepo(url,err => {
                        if (!err) {
                            console.log(chalk.green('All done!'));
                        }
                    })
                })
            }
        })
    }
})