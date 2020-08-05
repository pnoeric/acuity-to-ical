# acuity-to-ical

This simple script runs on a node server, and parses an Acuity feed into an iCal feed.

I use it for my personal trainer - I book my appointments with him on his Acuity booking page, then using this script, they appear on my calendar.

## How to Use

1. You have to run this using node on your own server.

2. Make a copy of the `.env.example` file and rename it to `.env` then edit as directed

3. When you visit the URL, you will receive an ICS (iCal) file in return. So just add the URL as a subscription in your favorite calendar app.

