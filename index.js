#!/usr/bin/env node

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
var URL = require('url')
var debug = require('debug')('gfm-wordpress')
var marked = require('marked')
var minimist = require('minimist')
var Highlight = require('highlight.js')

var CSS_FILENAME = require.resolve('highlight.js/styles/xcode.css')
var SITE = "http://developer.ibm.com/clouddataservices" // Set to your own blog. YMMV.


function usage() {
  console.error("Usage: node %s <path/to/README.md> [--media=<blog-media-location>]"
               +"\n\n"
               +"The --media option will help to generate correct URLs to the blog post's\n"
               +"media. Either use the post id such as '47/2016/01' or just paste an example URL:\n"
               +"http://developer.ibm.com/clouddataservices/wp-content/uploads/sites/47/2016/01/FoodTracker.png"
               , process.argv[1])
}

function main() {
  var argv = minimist(process.argv.slice(2))
  if (argv.help)
    return usage()

  var markdown_file = argv._[0]
  if (! markdown_file)
    return usage()

  var warning = null
  var media = normalize_media(argv.media)
  if (! media) {
    // Try to guess the media location using today's date. The format seems to be 47/YYYY/MM. No idea what that 47 is.
    var now = new Date
    var site_number = '47'
    media = site_number + '/' + now.getUTCFullYear() + '/' + pad(now.getUTCMonth()+1)

    warning = 'WARNING: You probably want to provide a media location. Run with --help for details.\n'
            + 'WARNING: Guessed media location: ' + media
  }

  fs.readFile(markdown_file, 'utf8', function(er, source) {
    if (er) {
      console.error(er.message)
      return usage()
    }

    gfm_to_wordpress({source:source, media:media}, function(er, html) {
      if (er)
        throw er

      console.log(html)

      // Print the warning if necessary, where the user can see it.
      if (warning)
        process.stderr.write('\n' + warning + '\n')
    })
  })
}


function gfm_to_wordpress(options, callback) {
  options = options || {}
  if (! options.source)
    throw new Error('Need options.source')
  if (! options.media)
    throw new Error('Need options.media')

  debug('Build HTML from %s source bytes; media=%j', options.source.length, options.media)

  // Use a custom heading renderer to build a table of contents.
  var toc_builder = mk_toc_builder()
  var renderer = new marked.Renderer
  renderer.heading = toc_builder.render_heading

  // Rewrite media (images and links) hosted from "media/*" to work from WordPress instead. Otherwise, leave it as-is.
  var render_image = renderer.image
  var render_link = renderer.link

  renderer.image = function(href, title, text) {
    var match = href.match(/^media\/(.*)$/)
    var filename = match && match[1]

    if (! filename) {
      debug('Normal image processing for non-media image: %s', href)
      return render_image.apply(this, arguments)
    }

    debug('Convert media/ image to WordPress: %s', href)
    var src = SITE + '/wp-content/uploads/sites/' + options.media + '/' + filename
    var alt = title || text
    title = title || text

    var img = '<img src="'+src+'" alt="'+alt+'" title="'+title+'" class="alignnone size-full" />'
    var link = '<a href="'+src+'">' + img + '</a>'

    return link
  }

  renderer.link = function(href, title, string) {
    var match = href.match(/^media\/(.*)$/)
    var filename = match && match[1]

    if (! filename) {
      debug('Normal link processing for non-media link: %s', href)
      return render_link.apply(this, arguments)
    }

    var target = SITE + '/wp-content/uploads/sites/' + options.media + '/' + filename
    var link = '<a href="'+target+'">' + string + '</a>'
    return link
  }

  marked(options.source, {gfm:true, highlight:highlighter, renderer:renderer}, function(er, html) {
    if (er)
      return callback(er)

    debug('Load CSS: %s', CSS_FILENAME)
    fs.readFile(CSS_FILENAME, 'utf8', function(er, css) {
      if (er)
        return callback(er)

      // Prepare the CSS styles with bugfixes. Remove newlines because WordPress will add paragraph tags.
      css = css + css_bugfixes()
      css = css.replace(/\n/g, '')

      var styles = '<style>' + css + '</style>\n'

      debug('Build TOC and insert into the document')
      var toc = toc_builder.render_toc()

      html = styles + html.replace(/(<h2 class="first-section">)/, toc + '$1')
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

    html.push('<ol class="table-of-contents" id="markdown-toc">')
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

    return html.join('')
  }
}

function highlighter(code, lang) {
  lang = lang || 'plain'
  debug('Highlight %j: %j', lang, code)
  var result = Highlight.highlightAuto(code, [lang])
  return result.value
}


// Return CSS to fix various display bugs in the code.
function css_bugfixes() {
  return [
    // Code embedded in ordered lists is too spaced out.
    'ol > li > p { margin-top: 0; }',

    // Tighten the spacing of the table of contents.
    'ol#markdown-toc > li { margin-top: 0; margin-bottom: 0; }',
    'ol#markdown-toc ol.subheading { margin-top: 0; margin-bottom: 0; }',
    'ol#markdown-toc ol.subheading > li { margin-bottom: 0; }',

    // Change subheadings to alphabatical (i.e. "section 3A").
    'ol#markdown-toc ol.subheading { list-style: upper-alpha; }',
  ].join('\n')
}

//
// Utilities
//

// Zero pad a number if necessary.
function pad(num) {
  return (num < 10) ? '0'+num : ''+num
}

// If a media location is given as an example URL, pull out only the useful parts.
function normalize_media(media) {
  if (!media || !media.match || !media.match(/^http/))
    return media // Not a URL

  var url = URL.parse(media)
  var match = url.pathname.match(/\/sites\/(\d+\/\d+\/\d+)\//)
  var media_id = match && match[1]
  return media_id || null
}

if (require.main === module)
  return main()
