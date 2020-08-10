// init project
const express = require('express')
const app = express()
var fs = require('fs')
var exists = require('fs-exists-sync')
var superagent = require('superagent')
var cheerio = require('cheerio')
var icalToolkit = require('ical-toolkit')
var moment = require('moment')
var util = require('util')
const tz = require('moment-timezone')

require('dotenv').config()

// how long to cache the output file?
const CACHE_MINUTES = process.env['NEVER_CACHE'] ? 0 : 120

// title for each event created
const APPT_SUMMARY = 'Gym - train w/Luke'

// location for each event created
const APPT_LOCATION = 'Friedaustrasse 12, 8003 Zürich'

// Acuity Scheduling URL - where you go to see all your appointments in Acuity
var base_url = process.env.ACUITY_BASE_URL
var login_url = process.env.ACUITY_LOGIN_URL

var debug = 0

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// we do this so we can save cookies
const request = superagent.agent()

var icsFileContent = ''

// sample login page for Acuity:
// /client-login.php?owner=12169722&PHPSESSID=q057ol0bgdoa6lg0hmshuv7h31&returnUrl=%2Fschedule.php%3Fowner%3D12169722%26

app.use(express.static('public'))

// location on server to cache output file
var outpath = __dirname + '/' + process.env.ICS_FILENAME
console.log('ICS file will be saved at ' + outpath)

var basicAuth = require('basic-auth')
app.use(function (request, response, next) {
  var user = basicAuth(request)
  if (
    !user ||
    user.name !== process.env.CALENDAR_USERNAME ||
    user.pass !== process.env.CALENDAR_PASSWORD
  ) {
    response.set('WWW-Authenticate', 'Basic realm="site"')
    return response.status(401).send()
  }
  return next()
})

// var j = request.jar();

app.get('/', function (req, response) {
  var doit = 0

  // first check if cache file even exists
  try {
    var stats = fs.statSync(outpath)
  } catch (err) {
    doit = 1
    console.log('Cache file not found.')
  }

  if (!doit) {
    // file does exist - check its age
    var mtime = new Date(util.inspect(stats.mtime)) // ex: 2018-04-22T18:41:58.844Z
    // console.log(mtime)

    var d2 = new Date()
    var d1 = new Date(mtime.toString())

    // figure out the difference in minutes... is the cache still fresh?
    var min = Math.ceil(((d2 - d1) / 1000 / 60).toString())
    var s = min == 1 ? '' : 's'
    if (min > CACHE_MINUTES) {
      doit = 1
      console.log(
        'It has been ' +
        min +
        ' minute' +
        s +
        ' since last generate, this is more than cache life (' +
        CACHE_MINUTES +
        ' minutes). Regenerating.'
      )
    }
  }

  if (debug || doit) {
    console.log('Regenerating ICS cache file.')

    fs.closeSync(fs.openSync(outpath, 'w'))

    // fetch login page for Acuity
    console.log('Getting login page @ ' + login_url)

    request
      .get(login_url)
      .withCredentials()
      .then(res => {
        // res.text, res.headers, res.status

        // console.log('Result status ' + res.status)
        //				console.log('Result headers ');
        //				console.log(res.headers);
        console.log('Finding form...')

        var $ = cheerio.load(res.text)

        $('form').filter(function () {
          var data = $(this)
          var post_url = data.attr('action')

          const credentials = { username: process.env.ACUITY_USERNAME, password: process.env.ACUITY_PASSWORD }

          console.log('Form post url = ' + post_url)
          console.log('Posting credentials back now...', credentials)

          request
            .post(base_url + post_url)
            .type('form')
            .send(credentials)
            .send({
              client_login: '1'
            })
            .then(res => {
              console.log(
                'Finished with logging in, result status = ' +
                res.status +
                ', result type = ' +
                res.type
              )

              // WOW!!!!! we have made it this far, now let's get ready to write out iCal file

              var builder = icalToolkit.createIcsFileBuilder()

              builder.spacers = true //Add space in ICS file, better human reading. Default: true
              builder.NEWLINE_CHAR = '\r\n' //Newline char to use.
              builder.throwError = false //If true throws errors, else returns error when you do .toString() to generate the file contents.
              builder.ignoreTZIDMismatch = true //If TZID is invalid, ignore or not to ignore!

              //Name of calander 'X-WR-CALNAME' tag.
              builder.calname = 'Luke Rennie Calendar'

              //Cal timezone 'X-WR-TIMEZONE' tag. Optional. We recommend it to be same as tzid.
              builder.timezone = process.env.TIMEZONE

              //Time Zone ID. This will automatically add VTIMEZONE info.
              builder.tzid = process.env.TIMEZONE

              builder.method = 'REQUEST'

              console.log('Starting appointment loop')

              // console.log(res.text);

              var $ = cheerio.load(res.text)

              // find ourselves some appointments
              $('.alert-success ul li').filter(function () {
                // this loop happens for each <li> element
                console.log('here is first li' + this)

                var data = $(this)

                // response.write( data.text() + "<br>" );

                // get the URL to edit this appointment
                const edit_url = data
                  .children()
                  .first()
                  .attr('href')
                  .replace(/^\/+/g, '')   // remove leading slash
                // <a href="schedule.php?action=appt&amp;owner=12169722&amp;id%5B%5D=75dc4df18c9c24e0dd8872254f6636a1&amp;PHPSESSID=v07144uup6tgl0fs483seoe5r3" data-original-text="March 20, 2018 18:15">March 20, 2018 18:15</a>

                console.log('edit_url is ' + edit_url)

                // now parse it to get the start time, etc.
                var str = data.text().substring(0, 24)
                if (str.indexOf('Cancel') == -1) {
                  var start_date_moment = moment.tz(
                    str,
                    'MMMM D, YYYY kk:mm',
                    builder.timezone
                  )

                  var start_date = start_date_moment.toDate()
                  if (start_date != 'Invalid Date') {
                    console.log('Start moment: ' + start_date_moment.format())
                    console.log('Start: ' + start_date)

                    var end_date_moment = start_date_moment
                      .tz(builder.timezone)
                      .add(1, 'hour')

                    var end_date = end_date_moment.toDate()

                    const nowStr = new Date().toLocaleString()
                    const descrString = 'To change appointment, visit ' + base_url + edit_url + '\n\nSynced at: ' + nowStr

                    console.log('End moment: ' + end_date_moment.format())
                    console.log('End: ' + end_date)

                    // add this event
                    builder.events.push({
                      //Event start time, Required: type Date()
                      start: start_date,

                      //Event end time, Required: type Date()
                      end: end_date,

                      //transp. Will add TRANSP:OPAQUE to block calendar.
                      transp: 'OPAQUE',

                      //Event summary, Required: type String
                      summary: APPT_SUMMARY,

                      //Alarms, array in minutes
                      alarms: [30],

                      //Location of event, optional.
                      location: APPT_LOCATION,

                      //Optional description of event.
                      description: descrString,

                      //What to do on addition
                      method: 'PUBLISH',

                      //Status of event
                      status: 'CONFIRMED',

                      organizer: {
                        name: 'Eric\'s Acuity -> ICS script',
                        email: process.env.ACUITY_USERNAME
                      }
                    })
                  }
                }
              })

              // generate ICS file
              icsFileContent = builder.toString()

              // any problems?
              if (icsFileContent instanceof Error) {
                console.log(icsFileContent)
                return console.log('Unable to generate ICS file for output.')
              }

              // all seems good, save ICS file
              console.log('Saving ICS file at ' + outpath)

              var fs = require('fs')
              fs.closeSync(fs.openSync(outpath, 'w'))
              fs.writeFile(outpath, icsFileContent, function (err) {
                if (err) {
                  console.log('Problem writing ics file to ' + outpath)
                  return console.log(err)
                }

                console.log(
                  'The ICS file has been cached to disk at ' + outpath
                )
              })
            })
            .catch(err => {
              // err.message, err.response
              console.log('Error loading logged-in page: ' + err.message)
              console.log(err.response)
              console.log(res.text)

            })
        })
      })
      .catch(err => {
        // err.message, err.response
        return console.log('Error loading login page: ' + err.message)
      })
  } else {
    console.log(
      'Just ' +
      min +
      ' minute' +
      s +
      ' since last generate; serving cached file.'
    )
  }

  // ALL DONE WITH THE HEAVY LIFTING.......
  // now just serve the file

  console.log('\nServing output...')

  // output the .ics file no matter what
  if (!debug) {
    response.writeHead(200, {
      'Content-Type': 'text/calendar',
      'Content-Disposition': 'attachment; filename=ical.ics'
    })
  }

  // read the cached file
  let readStream = fs.createReadStream(outpath)

  // When the stream is done being read, end the response
  readStream.on('close', () => {
    response.end()
  })

  // Stream chunks to response
  readStream.pipe(response)
})

exports = module.exports = app

// listen for requests :)
var listener = app.listen(process.env.ENDPOINT_PORT, process.env.ENDPOINT_HOSTNAME, function () {
  console.log('Your app is listening to ' + process.env.ENDPOINT_HOSTNAME + ':' + listener.address().port)
})
