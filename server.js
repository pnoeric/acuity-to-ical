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

env = require('dotenv').config()

// how long to cache the output file?
const CACHE_MINUTES = process.env.NEVER_CACHE === 'true' ? 0 : process.env.CACHE_LIFETIME_IN_MINUTES

// title for each event created
const APPT_SUMMARY = process.env.TITLE

// location for each event created
const APPT_LOCATION = process.env.LOCATION

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

console.log('STARTUP')
console.log('Cache length ' + CACHE_MINUTES + ' minutes')
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
			'It has been ' + min + ' minute' + s +
			' since last generate, this is more than cache life (' +
			CACHE_MINUTES + ' minutes). Regenerating.'
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

				console.log('Form post url = ' + base_url + post_url)
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

					// SO NOW in theory we are logged in....
					// console.log(res.text)

					// WOW!!!!! we have made it this far, now let's get ready to write out iCal file

					var builder = icalToolkit.createIcsFileBuilder()

					builder.spacers = true //Add space in ICS file, better human reading. Default: true
					builder.NEWLINE_CHAR = '\r\n' //Newline char to use.
					builder.throwError = false //If true throws errors, else returns error when you do .toString() to generate the file contents.
					builder.ignoreTZIDMismatch = true //If TZID is invalid, ignore or not to ignore!

					//Name of calander 'X-WR-CALNAME' tag.
					builder.calname = 'Luke Rennie Calendar'

					console.log('Parsing time zone ' + process.env.TIMEZONE)
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

						console.log('')
						console.log('------------------------')
						console.log('')

						// console.log('first child html ', $(this).html())

						let firstChildDomObject = $(this).children().first()

						// get the URL to edit this appointment
						let editLink = firstChildDomObject.attr('href')

						if (!editLink || firstChildDomObject.text().toLowerCase().indexOf('cancel') !== -1) {
							// console.log('This appointment is canceled, moving on')
						} else {

							editLink = editLink.replace(/^\/+/g, '')   // remove leading slash
							// <a href="schedule.php?action=appt&amp;owner=12169722&amp;id%5B%5D=75dc4df18c9c24e0dd8872254f6636a1&amp;PHPSESSID=v07144uup6tgl0fs483seoe5r3" data-original-text="March 20, 2018 18:15">March 20, 2018 18:15</a>

							// console.log('edit_url is ' + editLink)

							// now parse it to get the start time, etc.
							var str = firstChildDomObject.text().substring(0, 24)
							console.log('Found raw text time: ' + str)
							var start_date_moment = moment.tz(str, 'MMMM D, YYYY kk:mm', builder.timezone)

							var start_date = start_date_moment.toDate()
							if (start_date === 'Invalid Date') {
								console.log('Invalid start date, skipping', start_date_moment)
							} else {
								// console.log('Start: ' + start_date)
								console.log('Start formatted by moment: ' + start_date_moment.format())

								var end_date_moment = start_date_moment
								.tz(builder.timezone)
								.add(1, 'hour')

								var end_date = end_date_moment.toDate()

								const nowStr = new Date().toLocaleString()
								const descrString = 'To change appointment, visit ' + base_url + editLink + '\n\nSynced at: ' + nowStr

								// console.log('End: ' + end_date)
								console.log('End formatted by moment: ' + end_date_moment.format())

								// add this event

								console.log('ADDING this event: ' + APPT_SUMMARY + ' ' + start_date_moment.format('Y-MM-DD HH:mm:ss'))

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
					}
					)

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
				}
				)
				.catch(err => {
					// err.message, err.response
					console.log('Error loading logged-in page: ' + err.message)
					console.log(err.response)
					// console.log(res.text)

				})
			}
			)
		}
		)
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
