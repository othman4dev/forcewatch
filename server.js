const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio'); // You'll need to install this: npm install cheerio

const app = express();
const port = 3000;

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Middlewares
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Tell Express to serve static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.post('/download', (req, res) => {
  const videoUrl = req.body.url;
  if (!videoUrl) return res.send('No URL provided.');

  const fileName = `video_${Date.now()}.mp4`;
  const outputPath = path.join(downloadsDir, fileName);

  const command = `yt-dlp -o "${outputPath}" "${videoUrl}"`;

  exec(command, (error) => {
    if (error) {
      console.error(error);
      return res.send('Error downloading video.');
    }
    res.redirect(`/downloads/${fileName}`);
  });
});

// Add a new route for direct downloads from search results
app.get('/download', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.redirect('/');

  const fileName = `video_${Date.now()}.mp4`;
  const outputPath = path.join(downloadsDir, fileName);

  const command = `yt-dlp -o "${outputPath}" "${videoUrl}"`;

  exec(command, (error) => {
    if (error) {
      console.error(error);
      return res.send('Error downloading video.');
    }
    res.redirect(`/downloads/${fileName}`);
  });
});

app.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.redirect('/');
  
  // Get page number from query string or default to 1
  const page = parseInt(req.query.page) || 1;
  const perPage = 9; // Number of videos per page

  try {
    const response = await axios.get('https://www.youtube.com/results', {
      params: { search_query: query }
    });

    // Parse YouTube search results
    const videos = parseYouTubeSearchResults(response.data);

    // Render the search template with the parsed data
    res.render('search', { 
      query,
      videos,
      page,
      perPage
    });
  } catch (error) {
    console.error(error);
    res.render('error', {
      message: 'Error fetching search results'
    });
  }
});

// Function to parse YouTube search results
function parseYouTubeSearchResults(html) {
  const videos = [];
  const $ = cheerio.load(html);
  
  try {
    // First try to extract data from the JSON that's embedded in the page
    const scriptData = $('script').filter(function() {
      return $(this).text().includes('var ytInitialData = ');
    }).text();
    
    if (scriptData) {
      const jsonStart = scriptData.indexOf('var ytInitialData = ') + 'var ytInitialData = '.length;
      const jsonEnd = scriptData.indexOf('};', jsonStart) + 1;
      const jsonStr = scriptData.substring(jsonStart, jsonEnd);
      
      try {
        const data = JSON.parse(jsonStr);
        const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
        
        if (contents && contents.length > 0) {
          const itemSectionRenderer = contents.find(c => c.itemSectionRenderer)?.itemSectionRenderer;
          
          if (itemSectionRenderer && itemSectionRenderer.contents) {
            itemSectionRenderer.contents.forEach(item => {
              if (item.videoRenderer) {
                const videoRenderer = item.videoRenderer;
                
                // Extract video ID
                const videoId = videoRenderer.videoId;
                
                // Extract title
                const title = videoRenderer.title?.runs?.[0]?.text || 'Unknown Title';
                
                // Extract thumbnail
                const thumbnail = videoRenderer.thumbnail?.thumbnails?.[0]?.url || '';
                
                // Extract channel name
                const channel = videoRenderer.ownerText?.runs?.[0]?.text || 'Unknown Channel';
                
                // Extract view count
                const viewCountText = videoRenderer.viewCountText?.simpleText || 
                                      videoRenderer.viewCountText?.runs?.[0]?.text || 
                                      '0 views';
                
                // Extract duration
                const duration = videoRenderer.lengthText?.simpleText || 'Unknown';
                
                // Extract published time
                const publishedAt = videoRenderer.publishedTimeText?.simpleText || 'Unknown';
                
                videos.push({
                  id: videoId,
                  title,
                  thumbnail,
                  channel,
                  views: viewCountText,
                  duration,
                  publishedAt
                });
              }
            });
          }
        }
      } catch (e) {
        console.error('Error parsing YouTube JSON:', e);
      }
    }
    
    // If we didn't get any videos from JSON, try parsing HTML directly
    if (videos.length === 0) {
      $('div#contents ytd-video-renderer').each(function() {
        const videoId = $(this).find('a#thumbnail').attr('href')?.split('v=')[1] || '';
        const title = $(this).find('h3 a').text().trim();
        const thumbnail = $(this).find('img').attr('src') || '';
        const channel = $(this).find('ytd-channel-name a').text().trim();
        const views = $(this).find('span.style-scope.ytd-video-meta-block').first().text().trim();
        const duration = $(this).find('span#text.style-scope.ytd-thumbnail-overlay-time-status-renderer').text().trim();
        const publishedAt = $(this).find('span.style-scope.ytd-video-meta-block').last().text().trim();
        
        videos.push({
          id: videoId,
          title,
          thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          channel: channel || 'Unknown Channel',
          views: views || '0 views',
          duration: duration || 'Unknown',
          publishedAt: publishedAt || 'Unknown'
        });
      });
    }
  } catch (e) {
    console.error('Error parsing YouTube search results:', e);
  }
  
  // Add placeholders if no videos were found
  if (videos.length === 0) {
    for (let i = 0; i < 10; i++) {
      videos.push({
        id: `placeholder-${i}`,
        title: 'YouTube parsing error - Video unavailable',
        thumbnail: '/public/images/placeholder.jpg',
        channel: 'Unknown Channel',
        views: 'Unknown views',
        duration: 'Unknown',
        publishedAt: 'Unknown'
      });
    }
  }
  
  return videos;
}

// Static files
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

app.get('/error-test', (req, res, next) => {
  // Simulate different errors based on query parameters
  const statusCode = parseInt(req.query.code) || 500;
  
  if (req.query.type === 'exception') {
    // Simulate an exception
    throw new Error('This is a test exception');
  } else {
    // Simulate a specific error code
    const err = new Error('Test error with status ' + statusCode);
    err.statusCode = statusCode;
    next(err);
  }
});

app.use((req, res, next) => {
  const err = new Error('Page Not Found');
  err.statusCode = 404;
  next(err);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Global error handler - add this at the end of your file, before app.listen
app.use((err, req, res, next) => {
  // Set default status code if not specified
  const statusCode = err.statusCode || 500;
  
  // Log the error (in production you might want to use a proper logging library)
  console.error(err);
  
  // Set locals, only providing error in development
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  // Render the error page
  res.status(statusCode).render('error', {
    statusCode: statusCode,
    message: getErrorMessage(statusCode, err.message),
    error: isDevelopment ? err : null
  });
});

// Helper function to get appropriate error messages
function getErrorMessage(statusCode, defaultMessage) {
  const messages = {
    400: 'Bad Request - The request could not be understood or was missing required parameters.',
    401: 'Unauthorized - Authentication is required and has failed or has not been provided.',
    403: 'Forbidden - You do not have permission to access this resource.',
    404: 'Page Not Found - The requested page does not exist.',
    500: 'Internal Server Error - Something went wrong on our end.',
    503: 'Service Unavailable - The server is temporarily unable to handle the request.'
  };
  
  return messages[statusCode] || defaultMessage || 'An unexpected error occurred.';
}
