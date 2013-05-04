
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

/**
 * Routes
 */

app.get('/', function (req, res) {
  db.projects.find({
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

app.get('/projects/:id?', function (req, res) {
  db.projects.findOne({
    _id: db.ObjectId(req.params.id),
  }, function (err, project) {
    if ('edit' in req.query && req.user) {
      res.render('edit', {
        user: req.user,
        title: 'Olin Projects',
        project: project || {id: null, body: ''}
      })
    } else {
      res.render('project', {
        user: req.user,
        title: 'Olin Projects',
        project: project || {id: null, body: ''},
        resanitize: resanitize
      })
    }
  })
})

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
})

app.get('/names', function (req, res) {
  db.projects.distinct('name', function (err, names) {
    res.json(names);
  });
})

app.post('/projects/:id?', function (req, res) {
  if (!(req.body.title && req.body.body)) {
    res.json({error: true, message: 'Invalid quote'}, 500);
  }

  function splitLines (lines) {
    return lines.split(/\r?\n/).filter(function (a) {
      return !a.match(/^\s*$/);
    });
  }

  var MAXWIDTH = 800;

  function getOembed (url, next) {
    rem.json('http://api.embed.ly/1/oembed').get({
      key: process.env.EMBEDLY_KEY,
      url: url
    }, function (err, json) {
      next(null, !err && json);
    });
  }

  function getEmbeds (list, type) {
    return function (next) {
      async.map(splitLines(list), getOembed, function (err, results) {
        next(err, results && results.filter(function (a) {
          return a && a.type == type;
        }));
      });
    }
  }

  async.auto({
    images: getEmbeds(req.body.images, 'photo'),
    videos: getEmbeds(req.body.videos, 'video'),
    links: getEmbeds(req.body.links, 'link'),
  }, function (err, results) {
      db.projects.update({
        _id: req.params.id ? db.ObjectId(req.params.id) : null
      }, {
        title: req.body.title,
        body: req.body.body,
        images_text: req.body.images,
        videos_text: req.body.videos,
        links_text: req.body.links,
        images: results.images,
        videos: results.videos,
        links: results.links,
        submitter: req.user.username,
        date: Date.now(),
        large: req.body.body.length > 300,
        published: true
      }, {
        upsert: true
      }, res.redirect.bind(res, '/'));
  })
})

/**
 * Launch
 */

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on http://" + app.get('host'));
});
