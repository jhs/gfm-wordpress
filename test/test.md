# Awesome Blog Post

This is an awesome blog post.

I hope you like it. Read more at our [main blog][cds-blog].

## First Section

This is the first section. It should be the first entry in the table of contents.

### Section 1.1

This is a subsection of the first section. It should be the first nested entry in the table of contents.

### Section 1.2

This is another subsection. I think it is obvious where this belongs

### Section Goals

The goal of this section is for you to read the above subsections. Also, this section's heading will conflict with one below.

## Second section

This is the second section. How about some code samples?

### Section Goals

In this section, you will see some example code. Also, this section's heading conflicts with one above.

### Swift Hello World

Do this for an introduction to Swift

1. Open Xcode
1. Create a new file, `hello.swift`
1. In `hello.swift`, add this function:
  ``` swift
  #if DEBUG
      let target = "debugging world"
  #else
      let target = "world"
  #endif

  print("Hello, \(target)!")
  ```
1. You're done!

### JavaScript

And in JavaScript since I will surely need to publish some JS code at some point:

``` js
// passwd.js for Node.js
//
var fs = require('fs')

fs.readFile('/etc/passwd', 'utf8', function(er, passwd) {
  if (er)
    throw er

  var lines = passwd.split(/\n/)
  console.log('You have %s lines in your passwd file', lines.length)
})
```

#### How to run the code

To run this:

    node passwd.js --disable-bugs
    You have 96 lines in your passwd file

By the way, this section's heading should not get into the TOC because it is too minor.

## Conclusion

![Tux Penguin alt text](img/Tux.png)

In conclusion, I really hope this works. [Download FoodTracker][code-download]! This download should fail in GitHub because it is not committed into this project. But it should **succeed** from `npm test` because the link will be rewritten to the file hosted in WordPress.

Above is a picture of Tux, by Larry Ewing *<lewing@isc.tamu.edu>* who created it with [The Gimp][gimp]. Because it is linked from `img/` and not `media/`, it should render on GitHub and when running `npm test`.

Below is a screenshot of the iOS FoodTracker app. It is hosted in `media/` and so it should render on GitHub; but also, since it is already published on the IBM blog, it should render in the test too. It should be clickable to load the image directly off WordPress.

![The FoodTracker main screen](media/FoodTracker.png)


[END]: ----------------------------------------

[cds-blog]: https://developer.ibm.com/clouddataservices/blog/
[code-download]: media/FoodTracker-Cloudant-Sync-1.zip
[gimp]: https://www.gimp.org/
