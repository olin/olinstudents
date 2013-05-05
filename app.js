
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
  , rem = require('rem');

var app = express(), db;

app.configure(function () {
  db = mongojs(process.env.MONGOLAB_URI || 'olinprojects', ['projects']);
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

app.get('/', function (req, res) {
  res.redirect('/projects/');
})

function getImageUrl (url, width, height) {
  return "https://i.embed.ly/1/display/resize?" + require('querystring').stringify({
    key: process.env.EMBEDLY_KEY,
    url: url,
    width: width,
    height: height,
    grow: "false"
  });
}

app.get('/projects/:id?', function (req, res, next) {
  if ('edit' in req.query && !req.user) {
    return olinapps.loginRequired(req, res, next);
  }

  try {
    db.projects.findOne({
      _id: db.ObjectId(req.params.id),
    }, function (err, project) {
      if ('edit' in req.query) {
        olinapps.directory.people(req, function (err, directory) {
          console.log(directory);
          res.render('edit', {
            user: req.user,
            title: 'Olin Projects',
            project: project || {id: null, body: '', creators: [req.user.id]},
            directory: (directory && directory.people || []).map(function (a) {
              a.id = a.email.replace(/@.*$/, '');
              return a;
            })
          });
        });
      } else if (project && !project.published && !req.user) {
        return olinapps.loginRequired(req, res, next);
      } else if (project) {
        res.render('project', {
          user: req.user,
          title: 'Olin Projects',
          project: project,
          resanitize: resanitize,
          getImageUrl: getImageUrl
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
  db.projects.find(req.user ? {} : {
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

app.post('/delete', function (req, res) {
  db.projects.update({
    _id: db.ObjectId(req.body.id),
    submitter: req.user.username
  }, {
    $set: {
      published: false
    }
  }, function () {
    res.redirect('/');
  })
});


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

app.post('/projects/:id?', function (req, res) {
  if (!(req.body.title)) {
    return res.json({error: true, message: 'Invalid project. Please enter at least a title.'}, 500);
  }

  db.projects.findOne({
    _id: db.ObjectId(req.params.id),
  }, function (err, project) {
    if (project && project.submitter != req.user.username) {
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

        body: String(req.body.body),
        images_text: String(req.body.images),
        videos_text: String(req.body.videos),
        links_text: String(req.body.links),
        images: results.images,
        videos: results.videos,
        links: results.links,

        submitter: req.user.username,
        date: Date.now(),

        large: req.body.body.length > 300,
        published: !!req.body.public
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
