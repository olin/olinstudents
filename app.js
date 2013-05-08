
/**
 * Module dependencies.
 */

var express = require('express')
  , http = require('http')
  , path = require('path')
  , olinapps = require('olinapps')
  , mongojs = require('mongojs')
  , MongoStore = require('connect-mongo')(express)
  , resanitize = require('resanitize')
  , async = require('async')
  , rem = require('rem')
  , marked = require('marked');

var app = express(), db;

app.configure(function () {
  db = mongojs.connect(process.env.MONGOLAB_URI || 'olinprojects', ['projects'], {
    auto_reconnect: true,
    poolSize: 5
  });
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.set('secret', process.env.SESSION_SECRET || 'terrible, terrible secret')
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser(app.get('secret')));
  app.use(express.session({
    secret: app.get('secret'),
    store: new MongoStore({
      url: process.env.MONGOLAB_URI || 'mongodb://localhost/olinprojects'
    })
  }));
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function () {
  app.set('host', 'localhost:3000');
  app.use(express.errorHandler());
});

app.configure('production', function () {
  app.set('host', 'olinprojects.com');
});

/**
 * Authentication
 */

app.post('/login', olinapps.login);
app.all('/logout', olinapps.logout);
app.all('/*', olinapps.middleware);
app.all('/*', function (req, res, next) {
  req.user = olinapps.user(req);
  next();
})
app.get('/authenticate', olinapps.loginRequired, function (req, res) {
  res.redirect('/');
})

/**
 * Routes
 */

function isAuthorized (project, req) {
  return project && req.user && (project.submitter == req.user.username || req.user.username == 'timothy.ryan' || (project.creators || []).indexOf(req.user.username) >= -1);
}

function getImageUrl (url, width, height) {
  return "https://i.embed.ly/1/display/resize?" + require('querystring').stringify({
    key: process.env.EMBEDLY_KEY,
    url: url,
    width: width,
    height: height,
    grow: "false"
  });
}

var _directory = null

function getDirectoryCached (req, next) {
  if (_directory) {
    console.log('CACHED DIRECTORY', _directory);
    next(null, _directory);
  } else {
    olinapps.directory.people(req, function (err, directory) {
      if (err || !directory || !directory.people) {
        console.log('COULD NOT FETCH DIRECTORY');
        next(err || 'Could not fetch directory.', {people: []});
      } else {
        _directory = directory;
        console.log('FETCHED DIRECTORY', _directory);
        next(null, _directory);
      }
    });
  }
}

app.get('/', function (req, res) {
  res.redirect('/projects/');
})

app.get('/projects/:id?', function (req, res, next) {
  if ('edit' in req.query && !req.user) {
    return olinapps.loginRequired(req, res, next);
  }

  try {
    db.projects.findOne({
      _id: db.ObjectId(req.params.id),
      deleted: null
    }, function (err, project) {
      if ('edit' in req.query) {
        project = project || {id: null, body: '', creators: [req.user.id]},
        getDirectoryCached(req, function (err, directory) {
          res.render('edit', {
            user: req.user,
            title: 'Olin Projects',
            project: project,
            directory: directory.people.map(function (a) {
              a.id = a.email.replace(/@.*$/, '');
              return a;
            }),
            canedit: isAuthorized(project, req)
          });
        });
      } else if (project && !project.published && !req.user) {
        olinapps.loginRequired(req, res, next);
      } else if (project) {
        res.render('project', {
          user: req.user,
          title: 'Olin Projects',
          project: project,
          resanitize: resanitize,
          getImageUrl: getImageUrl,
          canedit: isAuthorized(project, req)
        })
      } else {
        next();
      }
    })
  } catch (e) {
    res.json({error: true}, 404);
  }
})

app.get('/projects', function (req, res) {
  db.projects.find(req.user ? {
    deleted: null
  } : {
    deleted: null,
    published: true
  }).sort({date: -1}, function (err, docs) {
    console.log(docs);
    res.render('index', {
      user: req.user,
      title: 'Olin Projects',
      projects: docs,
      resanitize: resanitize,
    });
  })
});

app.all('*', olinapps.loginRequired);

// app.post('/delete', function (req, res) {
//   db.projects.remove({
//     _id: db.ObjectId(req.body.id),
//     submitter: req.user.username
//   }, {
//     $set: {
//       published: false
//     }
//   }, function () {
//     res.redirect('/');
//   })
// });


function splitLines (lines) {
  return String(lines).split(/\r?\n/).filter(function (a) {
    return !a.match(/^\s*$/);
  }).map(function (a) {
    return (a.match(/^\S+/) || [''])[0]
  });
}

function getOembed (url, next) {
  rem.json('http://api.embed.ly/1/oembed').get({
    key: process.env.EMBEDLY_KEY,
    url: url
  }, function (err, json) {
    console.log(err, json);
    json.url = json.url || url;
    next(null, !err && json);
  });
}

function getEmbeds (list, type, type2) {
  // todo bind, next
  return function (next) {
    async.map(splitLines(list), getOembed, function (err, results) {
      next(err, results && results.filter(function (a) {
        return a && (a.type == type || a.type == type2);
      }));
    });
  }
}

app.post('/projects/:id/delete', function (req, res) {
  db.projects.findOne({
    _id: db.ObjectId(req.params.id),
    deleted: null
  }, function (err, project) {
    if (!project || !isAuthorized(project, req)) {
      return res.json({error: true, message: 'You do not have permission to edit this project.'}, 400);
    }

    project.deleted = true;
    db.projects.save(project, function (err, project) {
      res.redirect('/');
    });
  });
});

app.post('/projects/:id?', function (req, res) {
  if (!(req.body.title)) {
    return res.json({error: true, message: 'Invalid project. Please enter at least a title.'}, 500);
  }

  db.projects.findOne({
    _id: db.ObjectId(req.params.id),
    deleted: null
  }, function (err, project) {
    if (project && !isAuthorized(project, req)) {
      return res.json({error: true, message: 'You do not have permission to edit this project.'}, 400);
    }

    async.auto({
      images: getEmbeds(req.body.images, 'photo'),
      videos: getEmbeds(req.body.videos, 'video'),
      links: getEmbeds(req.body.links, 'link', 'rich'),
    }, function (err, results) {
      var creators = typeof req.body.creators == 'string' ? [req.body.creators] : req.body.creators;

      db.projects.update({
        _id: req.params.id ? db.ObjectId(req.params.id) : null
      }, {
        title: String(req.body.title),
        summary: String(req.body.summary),
        creators: creators,
        when: String(req.body.when),

        body_text: String(req.body.body),
        images_text: String(req.body.images),
        videos_text: String(req.body.videos),
        links_text: String(req.body.links),

        body: marked(String(req.body.body)),
        images: results.images,
        videos: results.videos,
        links: results.links,

        submitter: project && project.submitter || req.user.username,
        date: Date.now(),

        large: req.body.public || req.body.body.length > 500,
        published: !!req.body.public,
        deleted: null
      }, {
        upsert: true
      }, function () {
        res.redirect(req.url.replace(/\?.*$/, ''));
      });
    })
  })
});

/**
 * Launch
 */

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on http://" + app.get('host'));
});
