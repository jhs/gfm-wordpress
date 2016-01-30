module.exports = gfm_to_wordpress

// Copyright 2016 Jason Smith
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var fs = require('fs')
var debug = require('debug')('gfm-wordpress')
var marked = require('marked')
var Highlight = require('highlight.js')

function usage() {
  console.error("Usage: node %s <path/to/README.md>", process.argv[1])
}

function main() {
  var markdown_file = process.argv[2]
  if (! markdown_file)
    return usage()

  fs.readFile(markdown_file, 'utf8', function(er, source) {
    if (er) {
      console.error(er.message)
      return usage()
    }

    gfm_to_wordpress(source, function(er, html) {
      if (er)
        throw er

      console.log(html)
    })
  })
}


function gfm_to_wordpress(source, callback) {
  debug('gfm_to_wordpress: %s bytes', source.length)

  return callback(new Error('Not implemented'))
}


if (require.main === module)
  return main()
