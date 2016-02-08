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
var GREY = '#2d2e31'
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

    var dir = Path.dirname(markdown_file)
    gfm_to_wordpress({source:source, media:media, directory:dir, theme:ARGV.theme, is_minify:true}, function(er, html) {
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

  var base_dir = options.directory || '.'
  var theme = options.theme || 'xcode'
  debug('Build HTML (%s) from %s source bytes; media=%j', theme, options.source.length, options.media)

  // Use a custom heading renderer to build a table of contents.
  var toc_builder = mk_toc_builder()
  var renderer = new marked.Renderer
  renderer.heading = toc_builder.render_heading

  // Rewrite media (images and links) hosted from "media/*" to work from WordPress instead. Otherwise, leave it as-is.
  var render_image = renderer.image
  var render_link = renderer.link

  renderer.image = render_img
  renderer.link  = render_link

  marked(options.source, {gfm:true, smartypants:true, highlight:highlighter, renderer:renderer}, function(er, html) {
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

  function render_img(href, title, text) {
    var match = href.match(/^media\/(.*)$/)
    var filename = match && match[1]
    if (! filename) {
      debug('Normal image processing for non-media image: %s', href)
      return render_image.apply(this, arguments)
    }

    debug('Convert media/ image to WordPress: %s', href)
    var img = { src       : `/wp-content/uploads/sites/${options.media}/${filename}`
              , dim       : find_dimensions(base_dir + '/' + href)
              , text      : text || ''
              , title     : title || ''
              , style     : ''
              }
    var wrap = { before:[ `<a href="${img.src}">` ]
               , after :[ '</a>'              ]
               }
    debug('Image state: %j', img)

    // Use the title as a side-channel API to control things.
    var parts = img.title.split(';').map(function(line) { return line.trim() })
    img.title = parts.shift()
    parts.forEach(function(part) {
      // Support both "foo" and also "foo = bar".
      var opt = part.split(/\s*=\s*/)
      var key = opt[0]
      var val = opt[1]
      if (typeof val == 'undefined')
        val = true

      if (key == 'border') {
        img.dim.cssClass += ' border'

        // Allow overriding the color.
        if (val && typeof val == 'string')
          img.style += `background-color: ${val};`
      }

      if (key == 'figure') {
        // Make a floating "figure," with a caption.
        var mattCss = (val == 'left')
          ? 'alignleft'
          : 'alignright'

        wrap.before.unshift(`<div class="figure ${mattCss}">`)
        if (text)
          wrap.after.push(`<span class="caption">${text}</span>`)
        wrap.after.push('</div>')
      }
    }) // parts

    // Build the final HTML.
    var html = []
    html = html.concat(wrap.before)
    html.push(`<img src="${img.src}" alt="${img.text}" title="${img.title}" style="${img.style}"`
             +` class="${img.dim.cssClass}" height="${img.dim.height}" width="${img.dim.width}" />`)
    html = html.concat(wrap.after)

    debug('Image HTML: %j', html)
    return html.join('')
  }

  function render_link(href, title, string) {
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

    // An unused retina CSS class. This used to set 50% width however that was incompatible with WordPress/Jetpack.
    //'.pn-copy img.retina-2x { }',
    //'.pn-copy img.retina-3x { }',

    // Ensure that images do not float beside headings.
    '.pn-copy h2 { padding-top: 1em; }',
    '.pn-copy h1, .pn-copy h2, .pn-copy h3 { clear: both; }',

    // Images with borders.
    `.pn-copy .border { border: 1px solid ${GREY}; }`,

    // Figures with captions.
    '.pn-copy .figure { max-width: 66%; }',
    '.pn-copy .figure .caption { }',

    // Change subheadings to alphabatical (i.e. "section 3A").
    '.pn-copy ol.table-of-contents ol.subheading { list-style: upper-alpha; }'
  ]

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

  try { size = ImageSize(filename) }
  catch (er) {
    debug('Error finding image dimensions of %s: %s', filename, er.message)
  }

  if (size) {
    result.type = size.type
    result.width = size.width
    result.height = size.height

    var match = filename.match(/@(\d+)x\.\w\w\w$/)
    if (match) {
      var multiplier = +match[1]
      result.cssClass += ' retina-'+multiplier+'x' // e.g. retina-2x

      result.width = Math.round(result.width / multiplier)
      result.height = Math.round(result.height / multiplier)
    }
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
