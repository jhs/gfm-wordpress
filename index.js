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
var Path = require('path')
var debug = require('debug')('gfm-wordpress')
var marked = require('marked')
var minimist = require('minimist')
var Minifier = require('html-minifier')
var ImageSize = require('image-size')
var Highlight = require('highlight.js')

var ARGV = minimist(process.argv.slice(2))
var STYLES = 'highlight.js/styles'
var SITE = "http://developer.ibm.com/clouddataservices" // Set to your own blog. YMMV.


function usage() {
  console.error("Usage: node %s <path/to/README.md> [--media=<blog-media-location>] [--theme=zenburn | xcode | etc.] [--no-retina]"
               +"\n\n"
               +"The --media option will help to generate correct URLs to the blog post's\n"
               +"media. Either use the post id such as '47/2016/01' or just paste an example URL:\n"
               +"http://developer.ibm.com/clouddataservices/wp-content/uploads/sites/47/2016/01/FoodTracker.png"
               , process.argv[1])
}

function main() {
  if (ARGV.help)
    return usage()

  var markdown_file = ARGV._[0]
  if (! markdown_file)
    return usage()

  var warning = null
  var media = normalize_media(ARGV.media)
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

    gfm_to_wordpress({source:source, media:media, theme:ARGV.theme, is_minify:true}, function(er, html) {
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

  var theme = options.theme || 'xcode'
  debug('Build HTML (%s) from %s source bytes; media=%j', theme, options.source.length, options.media)

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

    // Set the CSS class. Add a retina class if it has a retina filename.
    var cssClass = 'alignnone size-full'
    match = filename.match(/@(\dx)\.\w\w\w$/)
    if (match)
      cssClass += ' retina-'+match[1]

    // Add "lazy-src" data to disable Photon resizing.
    var lazy_src = 'data-lazy-src="XXX"'
    lazy_src = ''
    var img = '<img src="'+src+'" alt="'+alt+'" title="'+title+'" class="'+cssClass+'" '+lazy_src+' />'
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

    debug('Load CSS theme: %s', theme)
    var css_filename = STYLES + '/' + theme + '.css'
    var css_path = require.resolve(css_filename)
    fs.readFile(css_path, 'utf8', function(er, css) {
      if (er)
        return callback(er)

      // Prepare the CSS styles with bugfixes. Remove newlines because WordPress will add paragraph tags.
      css = css + css_bugfixes()
      var styles = '<style>' + css + '</style>'

      debug('Build TOC and insert into the document')
      var toc = toc_builder.render_toc()

      html = styles + html.replace(/(<h2 class="first-section">)/, toc + '$1')

      if (options.is_minify)
        html = minify(html)

      callback(null, html)
    })
  })
}

// Return an object that can build a table of contents.
function mk_toc_builder() {
  // Conflicting section names causes a problem. Track the names to append a unique suffix if necessary (like GitHub does).
  var slugs = {}

  var h1_count = 0
  var headings = []
  var state = {headings:headings, render_heading:render_heading, render_toc:render_toc}
  return state

  // When rendering headings, a few things must happen:
  // 1. The first H1 header must be deleted. In GitHub, it looks nice at the top; but in Wordpress the title is managed separately.
  //    WordPress renders it as white on white, so we get a giant ugly white space.
  // 2. H2 and H3 headers should have anchor names (slugs) so that the TOC can link to them.
  // 3. Of course, build a table of contents linking to the sections.
  function render_heading(text, level) {
    var prepend = ''

    if (level == 1) {
      h1_count += 1
      if (h1_count == 1) {
        debug('Remove first H1, the article title: %s', text)
        return ''
      } else {
        debug('Skip TOC tracking for H1 header: %s', text)
      }
    } else if (level > 3) {
      debug('Skip TOC tracking for minor header: H%s', level)
    } else {
      // Figure out the TOC link. The href is usually normalized text, except if that conflicts with a prior heading.
      var slug = text.toLowerCase().replace(/[^\w]+/g, '-');
      if (! slugs[slug]) {
        // This is the first time this name was generated.
        slugs[slug] = 1
      } else {
        // The name collides with a previous one. Add the suffix and bump it for next time.
        slug = slug + '-' + slugs[slug]
        slugs[slug] += 1
      }

      var span = '<span class="header-link"></span>'
      var anchor = '<a name="'+slug+'">' + span + '</a>'
      prepend = anchor

      // Figure out where this goes on the TOC.
      if (level == 2)
        headings.push({text:text, href:slug, children:[]})
      else if (level == 3) {
        var parent = headings[headings.length - 1]
        parent.children.push({text:text, href:slug, children:[]})
      }
    }

    // The first section must have the TOC inserted above it. So, for the first H2, set a CSS
    // class "first-section" so that it can be found and have the TOC prepended.
    var css = ''
    if (level == 2 && headings.length == 1)
      css = ' class="first-section"'

    var header = prepend + '<h'+level + css+'>' + text + '</h'+level+'>'
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
  var style = [
    // Code embedded in ordered lists is too spaced out.
    '.pn-copy ol > li > p { margin-top: 0; }',

    // Make subheadings stand out a bit more.
    '.pn-copy h3 { font-size: 2.00rem; }',

    // Tighten the spacing of the table of contents.
    '.pn-copy ol.table-of-contents > li { margin-top: 0; margin-bottom: 0; }',
    '.pn-copy ol.table-of-contents ol.subheading { margin-top: 0; margin-bottom: 0; }',
    '.pn-copy ol.table-of-contents ol.subheading > li { margin-bottom: 0; }',

    // Change subheadings to alphabatical (i.e. "section 3A").
    '.pn-copy ol.table-of-contents ol.subheading { list-style: upper-alpha; }',
  ]

  // Reduce retina image sizes by half.
  if (ARGV.retina !== false)
    style.push('.pn-copy img.retina-2x { width: 50%; height: 50%; }')

  return style.join('\n')
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

// Return an object with dimension information of a filename. Uses synchronous i/o.
function find_dimensions(filename) {
  var size = null
  var result = {}
  result.cssClass = 'alignnone size-full'
  result.html = ''

  try { size = ImageSize(filename) }
  catch (er) {
    debug('Error finding image dimensions of %s: %s', filename, er.message)
  }

  if (size) {
    result.type = size.type
    result.width = size.width
    result.height = size.height
    result.html = ' height="'+size.height+'" width="'+size.width+'"'

    var match = filename.match(/@(\dx)\.\w\w\w$/)
    if (match)
      result.cssClass += ' retina-'+match[1]
  }

  debug('Dimensions of %s: %j', filename, result)
  return result
}

// Minify given HTML.
function minify(html) {
  var opts = { minifyCSS                    : true
             , removeIgnored                : true
             , removeComments               : true
             , collapseWhitespace           : true
             , conservativeCollapse         : true
             , removeEmptyAttributes        : true
             , removeRedundantAttributes    : true
             , removeScriptTypeAttributes   : true
             , removeStyleLinkTypeAttributes: true
             }
  var big = html.length

  html = Minifier.minify(html, opts)
  debug('Minify HTML %s -> %s bytes: %s%%', big, html.length, (100 * (big - html.length) / big).toFixed(2))
  return html
}

if (require.main === module)
  return main()
