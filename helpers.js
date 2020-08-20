const superagent = require('superagent')
const fs = require('fs')
const moment = require('moment')
const tz = require('moment-timezone')
const util = require('util')
const sa = superagent.agent()
const cheerio = require('cheerio')

async function doLogin (post_url) {
	return await sa.post(post_url)
	               .field('username', process.env.ACUITY_USERNAME)
	               .field('password', process.env.ACUITY_PASSWORD)
	               .field('client_login', '1')
	               .then(res => {
		               console.log('Finished with logging in')
		               return res.text
	               })
	               .catch(err => {
		               console.log('Error loading logged-in page ' + post_url + ': ' + err.message)
		               console.log('We are probably already logged in?')
	               })
}

async function saveFile (data, outputPath) {
	fs.closeSync(fs.openSync(outputPath, 'w'))
	fs.writeFile(outputPath, data, function (err) {
		if (err) {
			console.log('Problem writing ics file to ' + outputPath)
			return console.log(err)
		}

		console.log('The ICS file has been cached to disk at ' + outputPath)
	})
}

function findPostUrl (loginPageHtml) {
	const $ = cheerio.load(loginPageHtml)
	const post_url = $('form').attr('action')

	return post_url
}

async function getLoginPage (login_url) {
	return await sa.get(login_url)
	               .then(res => {
		               // res.data, res.headers, res.status
		               // console.log('Headers after GETTING login page', res.headers)
		               // console.log(res)
		               // console.log('Result status ' + res.status)

		               console.log('returning login page html, length: ' + res.text.length)
		               return res.text
	               })
}

function parseAppointments (rawHtml) {
	const iCalToolkit = require('ical-toolkit')

	// title for each event created
	const APPT_SUMMARY = process.env.TITLE

	// location for each event created
	const APPT_LOCATION = process.env.LOCATION

	const base_url = process.env.ACUITY_BASE_URL

	const $ = cheerio.load(rawHtml)

	let builder = iCalToolkit.createIcsFileBuilder()

	builder.spacers = true //Add space in ICS file, better human reading. Default: true
	builder.NEWLINE_CHAR = '\r\n' //Newline char to use.
	builder.throwError = false //If true throws errors, else returns error when you do .toString() to generate the file contents.
	builder.ignoreTZIDMismatch = true //If TZID is invalid, ignore or not to ignore!

	//Name of calander 'X-WR-CALNAME' tag.
	builder.calname = process.env.CALENDAR_NAME

	// console.log('Parsing time zone ' + process.env.TIMEZONE)
	//Cal timezone 'X-WR-TIMEZONE' tag. Optional. We recommend it to be same as tzid.
	builder.timezone = process.env.TIMEZONE

	//Time Zone ID. This will automatically add VTIMEZONE info.
	builder.tzid = process.env.TIMEZONE

	builder.method = 'REQUEST'

	console.log('Starting appointment loop')

	// console.log(res)

	// find ourselves some appointments
	$('.alert-success ul li').filter(function () {
		// this loop happens for each <li> element

		// console.log('')
		// console.log('------------------------')
		// console.log('')

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
			const dateString = firstChildDomObject.text().substring(0, 24)

			// console.log('Found raw text time: ' + dateString)
			const start_date_moment = moment.tz(dateString, 'MMMM D, YYYY kk:mm', builder.timezone)

			const start_date = start_date_moment.toDate()

			if (start_date === 'Invalid Date') {
				console.log('Invalid start date, skipping', start_date_moment)

			} else {

				// console.log('Start: ' + start_date)
				// console.log('Start formatted by moment: ' + start_date_moment.format())

				const end_date_moment = start_date_moment
				.tz(builder.timezone)
				.add(1, 'hour')

				const end_date = end_date_moment.toDate()

				const nowStr = new Date().toLocaleString()
				const description = 'To change appointment, visit ' + base_url + editLink + '\n\nSynced at: ' + nowStr

				// console.log('End: ' + end_date)
				// console.log('End formatted by moment: ' + end_date_moment.format())

				// add this event

				// console.log('ADDING this event: ' + APPT_SUMMARY + ' ' +
				// start_date_moment.format('Y-MM-DD HH:mm:ss'))

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
					description: description,

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
	const icsFileContent = builder.toString()

	// any problems?
	if (icsFileContent instanceof Error) {
		console.log(icsFileContent)
		return console.log('Unable to generate ICS file for output.')
	}

	return icsFileContent

}

module.exports = {

	checkCacheFile: async function (outputPath) {

		let breakCache

		// first check if cache file even exists and isn't empty
		try {
			let stats = fs.statSync(outputPath)
			breakCache = (stats.size === 0)

			// file does exist - check its age
			const mtime = new Date(util.inspect(stats.mtime)) // ex: 2018-04-22T18:41:58.844Z

			const d2 = new Date()
			const d1 = new Date(mtime.toString())

			// figure out the difference in minutes... is the cache still fresh?
			const min = Math.ceil(((d2 - d1) / 1000 / 60).toString())

			const s = (min === 1) ? '' : 's'

			if (min > process.env.CACHE_LIFETIME_IN_MINUTES) {
				breakCache = true
				console.log(
				'It has been ' + min + ' minute' + s +
				' since last generate, this is longer than cache lifetime of (' +
				process.env.CACHE_LIFETIME_IN_MINUTES + ' minutes). Regenerating.'
				)
			}

		} catch (err) {
			breakCache = true
			console.log('Cache file not found.', err)
		}

		return breakCache
	},

	buildFile: async function (outputPath) {
		// Acuity Scheduling URL - where you go to see all your appointments in Acuity
		const login_url = process.env.ACUITY_LOGIN_URL
		const base_url = process.env.ACUITY_BASE_URL

		// touch the output file
		fs.closeSync(fs.openSync(outputPath, 'w'))

		// fetch login page for Acuity
		console.log('Getting login page @ ' + login_url)

		const loginPageHtml = await getLoginPage(login_url)

		console.log('Got login page, length: ' + loginPageHtml.length + ' bytes')
		console.log('Finding form so we can get post URL...')

		const post_url = findPostUrl(loginPageHtml)

		let rawHtmlWithAllAppointments

		if (typeof post_url !== 'undefined') {

			console.log('Logging in...')
			rawHtmlWithAllAppointments = await doLogin(base_url + post_url)

		} else {

			console.log('Looks like we\'re already logged in, keep going...')
			rawHtmlWithAllAppointments = loginPageHtml
		}

		// console.log(rawHtmlWithAllAppointments)

		// SO NOW in theory we are logged in....
		// console.log(res.text)

		// WOW!!!!! we have made it this far, now let's get ready to write out iCal file

		let icsFileContent = parseAppointments(rawHtmlWithAllAppointments)
		console.log('ICS output: ' + icsFileContent.length + ' bytes')

		// all seems good, save ICS file
		console.log('Saving ICS file at ' + outputPath)

		saveFile(icsFileContent, outputPath)
	}
}

