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

var CSS_FILENAME = require.resolve('highlight.js/styles/xcode.css')


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
  debug('Build HTML from %s source bytes', source.length)

  // Use a custom heading renderer to build a table of contents.
  var toc_builder = mk_toc_builder()
  var renderer = new marked.Renderer
  renderer.heading = toc_builder.render_heading

  marked(source, {gfm:true, highlight:highlighter, renderer:renderer}, function(er, html) {
    if (er)
      return callback(er)

    debug('Load CSS: %s', CSS_FILENAME)
    fs.readFile(CSS_FILENAME, 'utf8', function(er, css) {
      if (er)
        return callback(er)

      // Prepare the CSS styles with bugfixes.
      var styles = '<style>' + css + '\n' + css_bugfixes() + '</style>\n'

      debug('Build TOC and insert into the document')
      var toc = toc_builder.render_toc()

      html = styles + html.replace(/(<h2 class="first-section">)/, toc + '\n' + '$1')
      callback(null, html)
    })
  })
}

// Return an object that can build a table of contents.
function mk_toc_builder() {
  // Conflicting section names causes a problem. Track the names to append a unique suffix if necessary (like GitHub does).
  var names = {}

  var headings = []
  var state = {headings:headings, render_heading:render_heading, render_toc:render_toc}
  return state

  function render_heading(text, level) {
    var content = text

    if (level == 1) {
      debug('Skip TOC tracking for H1 header')
    } else if (level > 3) {
      debug('Skip TOC tracking for minor header: H%s', level)
    } else {
      // Figure out the content. The href is usually normalized text, except if that conflicts with a prior heading.
      var href = text.toLowerCase().replace(/[^\w]+/g, '-');
      if (! names[href]) {
        // This is the first time this name was generated.
        names[href] = 1
      } else {
        // The name collides with a previous one. Add the suffix and bump it for next time.
        href = href + '-' + names[href]
        names[href] += 1
      }

      var span = '<span class="header-link"></span>'
      var anchor = '<a name="'+href+'" class="anchor" href="#'+href+'">' + span + '</a>'
      content = anchor + text

      // Figure out where this goes on the TOC.
      if (level == 2)
        headings.push({text:text, href:href, children:[]})
      else if (level == 3) {
        var parent = headings[headings.length - 1]
        parent.children.push({text:text, href:href, children:[]})
      }
    }

    // The first section must have the TOC inserted above it. So, for the first H2, set a CSS
    // class "first-section" so that it can be found and have the TOC prepended.
    var css = ''
    if (level == 2 && headings.length == 1)
      css = ' class="first-section"'

    var header = '<h'+level + css+'>' + content + '</h'+level+'>'
    debug('Render heading %s %j: %s', level, text, header)
    return header
  }

  function render_toc() {
    var html = ['<h2>Table of Contents</h2>']

    html.push('<ol class="table-of-contents">')
    headings.forEach(function(heading) {
      html.push('<li>')

      html.push('<a href="#' + heading.href + '">')
      html.push(heading.text)
      html.push('</a>')

      if (heading.children.length > 0) {
        html.push('<ol class="subheading">')
        heading.children.forEach(function(heading) {
          html.push('<li>')
          html.push('<a href="#' + heading.href + '">')
          html.push(heading.text)
          html.push('</a>')
          html.push('</li>')
        })
        html.push('</ol>')
      }

      html.push('</li>')
    })
    html.push('</ol>')

    return html.join('\n')
  }
}

function highlighter(code, lang) {
  lang = lang || 'plain'
  debug('Highlight %j: %j', lang, code)
  var result = Highlight.highlightAuto(code, [lang])
  return result.value
}


function css_bugfixes() {
  // Return CSS to fix various display bugs in the code.
  return (
    // Code embedded in ordered lists is too spaced out.
    'ol > li > p { margin-top: 0; }'

    // Change subheadings to alphabatical (i.e. "section 3A").
  + 'ol.table-of-contents ol.subheading { list-style: upper-alpha; }'
  )
}


if (require.main === module)
  return main()
