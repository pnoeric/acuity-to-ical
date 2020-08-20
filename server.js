/**
 * acuty-to-ical
 *
 */

const env = require('dotenv').config()

const express = require('express')
const app = express()

const util = require('util')

const helpers = require('./helpers')

const debug = 0

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const icsFileContent = ''

// sample login page for Acuity:
// /client-login.php?owner=12169722&PHPSESSID=q057ol0bgdoa6lg0hmshuv7h31&returnUrl=%2Fschedule.php%3Fowner%3D12169722%26

app.use(express.static('public'))

// location on server to cache output file
const outpath = __dirname + '/' + process.env.ICS_FILENAME

console.log('--- START ---')
console.log('Cache lifetime: ' + process.env.CACHE_LIFETIME_IN_MINUTES + ' minutes')
console.log('ICS file location: ' + outpath)

// go ahead and generate it as soon as we start node
// await helpers.main(outpath)

const basicAuth = require('basic-auth')
app.use(function (request, response, next) {
	const user = basicAuth(request)
	if (!user || user.name !== process.env.CALENDAR_USERNAME || user.pass !== process.env.CALENDAR_PASSWORD) {
		response.set('WWW-Authenticate', 'Basic realm="site"')
		return response.status(401).send()
	}
	return next()
})

app.get('/', async function (req, response) {
	const fs = require('fs')

	let breakCache

	if (process.env.NEVER_CACHE === 'true') {
		breakCache = true
	} else {
		let min = 0, s = ''

		breakCache = await helpers.checkCacheFile(outpath)
	}

	if (!(debug || breakCache)) {
		console.log('[CACHE] ' + min + ' minute' + s + ' since we generated cache file; serving it...')
	} else {
		console.log('*** Parsing appointments and generating new cache file...')

		await helpers.buildFile(outpath)
	}

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
const listener = app.listen(process.env.ENDPOINT_PORT, process.env.ENDPOINT_HOSTNAME, function () {
	console.log('Listening at http://' + process.env.ENDPOINT_HOSTNAME + ':' + listener.address().port + '\n')
})
