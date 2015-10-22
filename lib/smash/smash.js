var stream = require("stream"),
    queue = require("queue-async"),
    fs = require("fs"),
    expandFile = require("./expand-file"),
    emitImports = require("./emit-imports"),
    sourceMap = require("source-map");

function createGenerator(options) {
    if (options.inputSourceMap) {
      //TODO: implement consumer;
    }

    var sourceRoot = '';
    if (options.sourceMapRoot) {
      sourceRoot = options.sourceMapRoot;
    }

    var generator = new sourceMap.SourceMapGenerator({ sourceRoot: sourceRoot });
    return generator;
}

// Returns a readable stream for the specified files.
// All imports are expanded the first time they are encountered.
// Subsequent redundant imports are ignored.
module.exports = function(files, options) {
  var s = new stream.PassThrough({encoding: "utf8", decodeStrings: false}),
      q = queue(1),
      fileMap = {},

      outLineNo = 1,
      //FIXME: parse args
      generator = null;

  var sourceMapUrl = undefined;
  if (!options) {
    options = {};
  }
  if (options.sourceMap) {
    generator = createGenerator(options);
    sourceMapUrl = options.sourceMap;
    if (!sourceMapUrl) {
      sourceMapUrl = options.sourceMap;
    }
  }

  function addMapping(sourceFile, startLine, count) {
    for (var i = 0; i < count; i++, outLineNo++) {
      try {
        generator.addMapping({
            source: sourceFile
          , original: { line: startLine + i + 1, column: 0 }
          , generated: { line: outLineNo, column: 0 }
        });
      } catch (e) {
        console.error('when mapping sourceFile: %s, origLine: %d line: %d', sourceFile, startLine);
        throw(e);
      }
    }
  }

  // Streams the specified file and any imported files to the output stream. If
  // the specified file has already been streamed, does nothing and immediately
  // invokes the callback. Otherwise, the file is streamed in chunks, with
  // imports expanded and resolved as necessary.
  function streamRecursive(file, callback) {
    if (file in fileMap) return void callback(null);
    fileMap[file] = true;

    // Create a serialized queue with an initial guarding callback. This guard
    // ensures that the queue does not end prematurely; it only ends when the
    // entirety of the input file has been streamed, including all imports.
    var c, q = queue(1).defer(function(callback) { c = callback; });

    // The "error" and "end" events can be sent immediately to the guard
    // callback, so that streaming terminates immediately on error or end.
    // Otherwise, imports are streamed recursively and chunks are sent serially.
    emitImports(file)
        .on("error", c)
        .on("import", function(file) { q.defer(streamRecursive, file); })
        .on("data", function(data, file, line, linesCount) {
          q.defer(function(callback) {
            if (generator)
              addMapping(file, line, linesCount);
            s.write(data, callback); 
          }); 
        })
        .on("end", c);

    // This last callback is only invoked when the file is fully streamed.
    q.awaitAll(callback);
  }

  // Stream each file serially.
  files.forEach(function(file) {
    q.defer(streamRecursive, expandFile(file));
  });

  // When all files are streamed, or an error occurs, we're done!
  q.awaitAll(function(error) {
    if (error) s.emit("error", error);
    else {
      if (generator) {
        fs.writeFile(options.sourceMap, generator.toString());
        s.write("\n //# sourceMappingURL=" + sourceMapUrl + "\n")
      }
      s.end();
    }
  });

  return s;
};
