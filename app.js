
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
  db = mongojs.connect(process.env.MONGOLAB_URI || 'olinstudents', ['students'], {
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
      url: process.env.MONGOLAB_URI || 'mongodb://localhost/olinstudents'
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
  app.set('host', 'olinstudents.herokuapp.com');
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
  res.render('index.jade', {
    title: 'Olin Students',
    user: req.user
  });
})


/**
 * Launch
 */

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on http://" + app.get('host'));
});
