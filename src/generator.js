var EpubGenerator = function() {
    var fs           = require('fs'),
        XML          = require('libxmljs'),
        //translit    = require('../../translit'),
        base64Stream = require('base64stream'),
        zip          = new require('node-zip')(),

        uuid         = 'urn:uuid:' + require('node-uuid').v4(),
        mime         = 'application/epub+zip',
        nameSpace    = {
            opf : 'http://www.idpf.org/2007/opf',
            ncx : 'http://www.daisy.org/z3986/2005/ncx/'
        };

    var container, chapter, opfDom, ncxDom;

    function readFile (file, type, callback) {
        fs.readFile(__dirname + '/../..' + file, function(err, content) {
            if (err) return callback(err);
            callback(null, content.toString(type));
        });
    }

    function addStringFile(fileName, content, id) {
        // Update OPF file
        opfDom.get('//opf:manifest', nameSpace).node('item').attr({
            'href' : fileName,
            'media-type' : mimeFromName(fileName),
            'id' : (id || idFromName(fileName))
        });

        // Add file to ZIP
        zip.file('OPS/' + fileName, content, {base64 : false});
    }
    
    function addBinaryFile (file, id, callback) {
        var data   = '';
        var stream = new base64Stream.BufferedStreamToBase64();

        stream.on('data', function(chunk){
            data += chunk;
        }).on('end', function() {
            // Update OPF file
            opfDom.get('//opf:manifest', nameSpace).node('item').attr({
                'href' : file.filename,
                'media-type' : mimeFromName(file.filename),
                'id' : (id || idFromName(file.filename))
            });
            // Add file to ZIP
            zip.file('OPS/' + file.filename, data, {base64 : true});
            callback(null);
        }).on('error', callback);

        // Write stream
        file.stream.pipe(stream);
    }

    function idFromName(name) {
        return name.replace(/[^A-Za-z]/, '') + (new Date()).getTime();
    }

    function mimeFromName(name) {
        switch(name.split('.').pop()) {
            case 'ncx':
                return 'application/x-dtbncx+xml';
            case 'xml':
                return 'application/xhtml+xml';
            case 'html':
                return 'application/xhtml+xml';
            case 'xhtml':
                return 'application/xhtml+xml';
            case 'jpg':
                return 'image/jpeg';
            case 'jpeg':
                return 'image/jpeg';
            case 'gif':
                return 'image/gif';
            case 'png':
                return 'image/png';
            case 'svg':
                return 'application/svg+xml';
            case 'ttf':
                return 'application/x-opentype-font';
            case 'js':
                return 'text/javascript';
            case 'css':
                return 'text/css';
            case 'txt':
                return 'text/plain';
            default:
                return 'application/octet-stream';
        }
    }

    function addChapter(id, title, content) {
        var chapterId = 'epubchapter' + id;
        var fileName  = chapterId + '.xhtml';

        // Fuck DOM
        var chapter = '<?xml version="1.0" encoding="UTF-8"?>' +
            '<html xmlns="http://www.w3.org/1999/xhtml">' +
                '<head><title /><link rel="stylesheet" href="style.css" type="text/css" /></head>' +
                '<body><div class="section" id="' + chapterId + '">' +
                    '<div class="title1"><p class="title-p">' + title + '</p></div>' +
                    content +
                '</div></body>' +
            '</html>';

        // Update NCX file.
        // Create
        // <navPoint>
        //      <navLabel>
        //          <text></text>
        //      </navLabel>
        //      <content />
        // </navPoint> structure
        ncxDom.get('//ncx:navMap', nameSpace)
            .node('navPoint').attr({'id' : chapterId, 'playOrder' : id})
                .node('navLabel')
                    .node('text', title)
                .parent()
            .parent()
                .node('content').attr({'src' : fileName + '#' + chapterId})
            .parent()
        .parent();

        chapterId = 'chap' + id;

        // Update OPF file
        opfDom.get('//opf:spine', nameSpace).node('itemref').attr({'idref' : 'chap' + id});

        // Add file
        addStringFile(fileName, chapter, chapterId);
    }

    return {
        prepare : function(next) {
            // Parse OPF document
            readFile('/libs/epub/opf.xml', 'utf8', function(err, content) {
            	if (err) next(err);
            	opfDom = XML.parseXmlString(content);
            	
            	// Parse NCX document
            	readFile('/libs/epub/ncx.xml', 'utf8', function(err, content) {
            		if (err) next(err);
            		ncxDom = XML.parseXmlString(content);
            		
            		// Read container file
            		readFile('/libs/epub/container.xml', 'utf8', function(err, content) {
            			if (err) next(err);
            			container = content;
            			
            			// Read chapter file
            			readFile('/libs/epub/chapter.xml', 'utf8', function(err, content) {
            				if (err) next(err);
            				chapter = content;
            				
				            // Add mimetype to zip
				            zip.file('mimetype', mime);
				            
            				next();
            			});
            			
            		});
            		
            	});
            });
        },
        title : function(title, next) {
            opfDom.get('//opf:metadata', nameSpace).node('title', title);
            ncxDom.get('//ncx:docTitle', nameSpace).node('text',  title);
            
            next();
        },
        cover : function(cover, next) {
            if (!cover) {
                return;
            }

            // Add file
            var Model = require('../../models/book').Book(mongoDb),
                book = new Model();

            book.getCover(cover, function(error, file) {
                if (error) {
                    return next(error);
                } else {
                    // Update Book xml
                    opfDom.get('//opf:metadata', nameSpace).node('meta').attr({name : 'cover', content : 'cover'});

                    addBinaryFile(file, 'cover', next);
                }
            });
            
        },
        author : function(author, next) {
            opfDom.get('//opf:metadata', nameSpace).node('dc:creator', author).attr({'opf:role' : 'aut'});
            ncxDom.get('//ncx:docAuthor', nameSpace).node('text', author);
            
            next();
        },
        language : function(language, next) {
            language = language || 'en';
            opfDom.get('//opf:metadata', nameSpace).node('dc:language', language);
            
            next();
        },
        date : function date (date, next) {
            next();
        },
        content : function(chapters, next) {
            for (var i in chapters) {
                // Start chapters from the first, not zero.
                addChapter(i - 0 + 1, chapters[i].title, chapters[i].content.replace(/<br>/g, '<br />'));
            }
            
            next();
        },
        css : function(css, next) {
            if (css) {
                addStringFile('style.css', css, 'css_style');
            } else {
                readFile('/libs/epub/style.css', 'utf8', function(err, content) {
                    if (err) next(err);
                    addStringFile('style.css', content, 'css_style');
                    next();
            	});
            }
            
            next();
        },
        images : function(images, next) {
            for (var i in images) {
                this.addImage(images[i], i, next);
            }
            
            next();
        },
        addImage : function addImage (image, i, next) {
            readFile('/public/uploads/' + image, 'base64', function(err, content) {
                if (err) next(err);
                // Add file
                addBinaryFile(image, 'image_' + i, next);
            });
        },
        notes : function(notes, next) {
            // Add file
            readFile('/libs/epub/notes.xhtml', 'utf8', function(err, content) {
                if (err) next(err);
                addStringFile('notes.xhtml', content);
            
                next();
            });
        },
        getMime : function getMime () {
            return mime;
        },
        finalize : function() {
            // Update OPF file
            opfDom.get('//opf:metadata', nameSpace).node('dc:identifier', uuid).attr({'id' : 'BookID'});

            // Update NCX file
            ncxDom.get('//ncx:head', nameSpace).node('meta').attr({'name' : 'dtb:uid', 'content' : uuid});

            // Add NCX file
            addStringFile('toc.ncx', ncxDom.toString(), 'ncx')

            // Add OPF file to ZIP
            zip.file('OPS/content.opf', opfDom.toString());

            // Add Container to ZIP
            zip.file('META-INF/container.xml', container);

            return new Buffer(zip.generate({
                base64 : false
            }), 'binary');
        }
    }
}

module.exports = EpubGenerator;