# gfm-wordpress

Process GitHub flavored Markdown so it can be pasted directly into Wordpress.

I (Jason Smith) use this tool for writing blog posts in a project on GitHub, but then publish them on the IBM Developerworks blog. If you are not blogging for the Cloud Data Services developer advocacy group, I am not sure you will find this very useful. But maybe.

## Features

GFM-Wordpress does a few things:

1. Convert GitHub-flavored Markdown to HTML
1. In-line syntax highlighting (no need for existing CSS rules), since I cannot change the CSS rules of the blog
1. Build a Table of Contents
1. Automatically correct links to a `media/` subdirectory, so that they work from Wordpress

## Usage

    npm install --global gfm-wordpress
    gfm-wordpress README.md # HTMl output on stdout

You can paste the HTML into the blog post, and upload all `media/*` files. The HTML will already link to the media files, so there is no need to use Wordpress to link them in.

## License

Apache 2.0
