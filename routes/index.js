var express = require('express');
var router = express.Router();

// Initialiser Busboy. Forenkler håndteringen av opplastede filer.
// https://github.com/mscdex/busboy
var Busboy = require('busboy');
// Driver for  mongoDB
// https://github.com/mongodb/node-mongodb-native
var mongo = require('mongodb');
// Initialiser GridFS. Lar oss stykke opp og skrive filer til MongoDB
// https://github.com/aheckmann/gridfs-stream
var grid = require('gridfs-stream');

var crypto = require('crypto');

// Koble til mongoDB
var db = new mongo.Db('test', new mongo.Server('127.0.0.1', 27017));
var gfs;

// Åpne DB connection
db.open(function(err, db) {
  if (err) throw err;
  // Gi GridFS database connection. Denne bruker vi videre for å jobbe med databasen
  // Bygger rundt/på eksisterende mongoDB-funksjoner
  gfs = grid(db, mongo);
});

// På post, i rooten av prosjektet vårt - localhost:300/ - har vi logikk for å ta i mot filen
router.post('/', function(req, res, next) {
  // Gi busboy request-headers (med bl.a. filopplastingsdataene)
  var busboy = new Busboy({ headers : req.headers });
  // Opprett en tom peker til et nytt dokument i MongoDB
  var fileId = new mongo.ObjectId();
  // Hekt oss på busboy sine events. "file" eventen lytter, og kjører callbacken når en filopplasting har startet.
  // Inne i denne callbacken skjer det
  busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
    console.log('got file', filename, mimetype, encoding);
    // Set opp en stream og pipe filen med GridFS. Sjekk docs
    var writeStream = gfs.createWriteStream({
      _id: fileId,
      filename: filename,
      mode: 'w',
      content_type: mimetype,
    });
    file.pipe(writeStream);
  }).on('finish', function() {
    // Neste event er "chainet" på forrige event. Den kjøres når filen er "finished"/ferdig opplastet.
    // Da kan vi f.eks. vise en lenke til filen
    res.writeHead(200, {'content-type': 'text/html'});
    res.end('<a href="/showfile/' + fileId.toString() + '">download file</a>');
  });
  // Pipe requesten til busboy.
  // Dette skjer "før" busboy.on('file'... osv sine callback, siden de er asynkrone events, og skjer når brukeren faktisk laster opp filer.
  req.pipe(busboy);
});

// På login, vis loginsiden
router.get('/login', function(req, res, next) {
  res.render('login', { title: 'Express' });
});

// På post /login, sjekker vi om brukeren har sendt inn skjemaet og dermed muligens logget inn
router.post('/login', function(req, res, next) {

  // Vi skal bruke crypto-biblioteket til å sjekke om rentekst-passordet matcher md5-hashet passordet som ligger i databasen.
  //
  // Hent ut innsendt passord fra requesten, lag md5-hashet versjon. Legg i variabel.
  var hash = crypto.createHash('md5').update(req.body.password).digest("hex");

  // Koble til databasen og sjekk variabel-verdien for en match i databasen.
  // Sjekker om brukerenavn-feltet stemmer, samt passord-feltet stemmer med variabelen "hash"
  db.collection('user').findOne({ brukernavn: req.body.username, passord: hash }, function(err, doc) {
    if (doc){
      // Match. Vi kan lage en session, og setter loggedIn=true på denne
      sess = req.session;
      sess.loggedIn = true;
      // Rendrer index.jade
      res.render('index');
    } else {
      // Ingen match. Redirect til root
      res.redirect('/');
    }
  });

});

// Denne er viktig når vi laster siden på nytt.
// Har vi startet en session, så vil vi fortsatt ha en cookie satt, og req.session.loggedIn=true.
router.get('/', function(req, res, next){
  if(!req.session.loggedIn){
    // Fortsatt ingen match, redirect til login-siden
    res.redirect('/login');
  }
  else{
    res.render('index'); // Logget inn
  }
});

// Se linje 50. Refererer til res.end('<a href="/showfile/' + fileId.toString() + '">download file</a>');
router.get('/showfile/:id', function(req, res, next){
  // Når man klikker på den opplastede filen, laster vi show.jade, men iden til filen
  res.render('show', {id: req.params.id});
});

// I show.jade viser urlen til img(src="/file/#{id}" width="200")
// Denne korresponderer med denne get-routen. Den viser kun bildet, basert på id som parameter
router.get('/file/:id', function(req, res, next){
  // Baser på id, sjekk for match i databasen. Bruk gridFS
  gfs.findOne({ _id: req.params.id }, function (err, file) {
    // Hvis feil, send 400 error
    if (err) return res.status(400).send(err);
    // Hvis ingen match, send 404 file not found
    if (!file) return res.status(404).send('');
    res.set('Content-Type', file.contentType);
    // Lag en http response med noen headers
    res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');
    var readstream = gfs.createReadStream({
      _id: file._id
    });
    readstream.on("error", function(err) {
      console.log("Got error while processing stream " + err.message);
      res.end();
    });
    // Pipe filen til responsen
    readstream.pipe(res);
  });
});

module.exports = router;
