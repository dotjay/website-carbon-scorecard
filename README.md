# Website carbon scorecard

A command-line tool for estimating the carbon emissions of a website.

Author: Jon Gibbins, https://digitalasitshouldbe.com/

## Install

### Pre-requisites

* Node.js version 18.3.0 or higher  
* NPM, which usually comes bundled with [Node.js](http://Node.js)

### Dependencies

The following dependencies will be installed by NPM during installation: 

* [CO2.js](https://www.thegreenwebfoundation.org/co2-js/)  
* [Puppeteer](https://www.npmjs.com/package/puppeteer) with Chromium  
* [simplecrawler](https://www.npmjs.com/package/simplecrawler)  
* [sitemapper](https://www.npmjs.com/package/sitemapper)

If you are running this on a Linux server (like Ubuntu or Debian), you might need to install additional system libraries for Chromium to launch correctly: 

```shell
# Install additional Linux libraries
sudo apt-get install -y libgbm-dev wget gnupg

# Or use the built-in puppeteer command
npx puppeteer browsers install chrome
```

### Download code and install Node packages

The easiest way to do this is to open a command-line interface (like Terminal on macOS), clone the repository to your local machine, and install the required dependencies:

```shell
git clone https://github.com/dotjay/website-carbon-scorecard.git
cd website-carbon-scorecard
npm install
```

Note: During `npm install`, Puppeteer will download a compatible version of Chromium (approx. 170 MB to 280 MB depending on your OS).

## Using website-carbon-scorecard.js

The following gives you an overview of how the scorecard can be used. You can find out more about the various options at any time by running: 

`node website-carbon-scorecard.js --help`

### Assess a website

The basic command will look for `/sitemap.xml` and use this to assess URLs for the whole website, or fall back to crawling the website: 

`node website-carbon-scorecard.js https://example.org/`

### Assessing a specified set of URLs

You can specify a text file that lists the URLs to assess (one per line), which is useful for assessing a user journey: 

`node website-carbon-scorecard.js --input=journey1.txt`

Example text file: 

```
https://digitalasitshouldbe.com/
https://digitalasitshouldbe.com/about/
https://digitalasitshouldbe.com/approach/
https://digitalasitshouldbe.com/services/consulting/
https://digitalasitshouldbe.com/contact/
```

### Adjusting output

By default, results are displayed as a table in the command-line environment, equivalent to setting `--output=cli`. Results can also be output as comma-separated values using `--output=csv`, which is useful for then pasting the data into spreadsheets, etc.

`node website-carbon-scorecard.js --output=csv https://digitalasitshouldbe.com/`

You may like to output the data to a file rather than the command-line environment: 

`node website-carbon-scorecard.js --output=csv https://digitalasitshouldbe.com/ > example-results.txt`

The [digital carbon rating](https://sustainablewebdesign.org/digital-carbon-ratings/) for each page is displayed by default. You can hide these using the `--no-ratings` option: 

`node website-carbon-scorecard.js --no-ratings https://digitalasitshouldbe.com/`

### Measurement settings

#### Digital carbon model

By default, the scorecard uses the latest version of the [Sustainable Web Design Model](https://sustainablewebdesign.org/estimating-digital-emissions/) to estimate the carbon emissions of each web page assessed. You can change the model used to other options using the `--model` option: 

`node website-carbon-scorecard.js --model=1byte https://example.org/`

The following digital carbon models are available: 

* 'swd' \= the latest version of Sustainable Web Design Model (default)  
* 'swd3' \= version 3 of the Sustainable Web Design Model  
* 'swd4' \= version 4 of the Sustainable Web Design Model  
* '1byte' \= the OneByte model

Note that the OneByte model does not support carbon ratings.

You can read [more about these models in the CO2.js documentation](https://developers.thegreenwebfoundation.org/co2js/models/overview/).

#### Measurement options

By default, the scorecard measures the size of pages when [Puppeteer's life cycle](https://pptr.dev/api/puppeteer.puppeteerlifecycleevent) detects that there are no more than 2 network connections for at least 500 ms, and uses the Chrome DevTools Protocol to measure the size. This behaviour can be changed using the `--measure-event` and `--measure-mode` options: 

* `--measure-event=idle` (i.e. `networkidle2`, default) or `load`  
* `--measure-mode=cdp` (Chrome DevTools Protocol, default) or `buffer` (experimental and not recommended)

#### Number of pages assessed

By default, the number of pages assessed is limited to the first 100 pages. So, if the `sitemap.xml` file of a website has 150 URLs, only the first 100 are assessed. This can be adjusted using the `--max-pages` option: 

`node website-carbon-scorecard.js --max-pages=5 https://digitalasitshouldbe.com/`

## Using the scorecard spreadsheet

1. [Make a copy](https://docs.google.com/spreadsheets/u/0/d/1lNjpv0bMpXY84OSkJ63hOJ-ypz0Sc9qY9gdgLVB19n0/copy) of the [Website carbon scorecard (template)](https://docs.google.com/spreadsheets/d/1lNjpv0bMpXY84OSkJ63hOJ-ypz0Sc9qY9gdgLVB19n0/preview)  
2. Rename the file: Website carbon scorecard for yourwebsite.org  
3. In the ‘Results (website)’ sheet, follow the instructions (highlighted in yellow) to:   
   1. Set your website root URL.  
   2. Set the date of the first measurement (the ‘From’ date in cell B3) in YYYY-MM-DD format – we will gather the data for this using the tool in a moment. The data from this first measurement will be added to a data sheet that must have this date as its name. The example ‘From’ data sheet is called ‘2025-11-01’. You can double click this data sheet's tab to change its name to reflect your ‘From’ date.  
   3. Optionally, the date of a second measurement may also be set (the ‘To:’ date in cell B4) in YYYY-MM-DD format. If you don't yet have a second set of data, you can delete this until you take further measurements. Again, the name of the data sheet must be the date of the measurement in YYYY-MM-DD format.

Notes: 

* The cells in rows 7-12 of the results sheets are hidden as they are used to run calculations on the data.  
* The scorecard spreadsheet can calculate Digital Carbon Ratings for us, allowing us to switch between ratings models, but it *will not* adjust the carbon emissions of each page to the selected model. You can change the carbon measurement model used in the ‘Settings’ sheet. By default, we use the latest version of the [Sustainable Web Design Model](https://sustainablewebdesign.org/estimating-digital-emissions/).  
* The ‘Processing’ sheet combines the URLs found in the two data sets used by the ‘Results (website)’ sheet, since URLs may be added or removed between measurements. Avoid editing this sheet directly.

4. Run `website-carbon-scorecard.js` on the website being tested to get the data, adding the `--output=csv` option to output the data as comma-separated values:   
   // This assesses the website using its sitemap.xml  
   // (or by crawling the site if there is no sitemap)  
   node website-carbon-scorecard.js \--output=csv https://example.org/  
     
   // Or you can specify a text file of URLs to assess  
   node website-carbon-scorecard.js \--output=csv \--input=journey1.txt
     
   // You may like to output the data to a file  
   node website-carbon-scorecard.js \--output=csv \--input=journey1.txt \> ./journey1-results.txt

5. Name one of the data sheets with the date that the measurement was taken, and paste the data from `website-carbon-scorecard.js` into it  
   1. First visit data can be pasted into Column A, then select ‘Split text to columns’ from the ‘Data’ menu to get Google Sheets to split the CSV data and populate Columns B-D.  
   2. Return visit data can be pasted into Column E, then select ‘Split text to columns’ from the ‘Data’ menu to populate Columns F-H.  
6. Switch back to the ‘Results (website)’ sheet  
   1. If you haven't already done so, enter the date that your data was created as the ‘From’ date (cell B3).  
   2. If the ‘To’ date is set (cell B4), you can clear it.  
   3. See the data for the website (or the journey URLs tested) visualised with carbon grades.  
7. Run `website-carbon-scorecard.js` on the website again at a later date, and repeat the process in a second source sheet, naming the sheet with the date. Enter the date that this new data was created as the ‘To’ date (cell B4) to compare the data from two measurements.  
8. In the ‘Results (journey)’ sheet, you can focus on the results for a particular set of URLs, which is useful for assessing a user journey. When you enter the site URLs in row 6, the data associated with that URL is displayed.
