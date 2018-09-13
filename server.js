const serverless = require('serverless-http')
const fs = require('fs')
const cors = require('cors')
const express = require('express')
const ReactDOMServer = require('react-dom/server')
const App = require('./dist/index.server.bundle.js')
const bodyParser = require('body-parser')
const AWS = require('aws-sdk')
const app = express()
const template = fs.readFileSync(`${__dirname}/dist/index.html`, 'utf8') // stupid simple template.
const port = process.env.SERVER_PORT || 3000
const tableName = process.env.TODO_TABLE || 'todos'
const eventQueueName = process.env.TODO_EVENT_QUEUE || 'todos-events'
const awsRegion = process.env.AWS_REGION || 'eu-west-1'

// Lazy initialize it later
let eventQueueUrl = null

// Set default region
process.env.AWS_REGION = awsRegion
AWS.config.update({ region: awsRegion })
const SQS = new AWS.SQS({ apiVersion: '2012-11-05' })
const dynamoDb = new AWS.DynamoDB.DocumentClient()

// These are loaded if you call POST /api/init
const initialTodos = [
  { id: 'ed0bcc48-bbbe-5f06-c7c9-2ccb0456ceba', title: 'Wake Up.', completed: true },
  { id: '42582304-3c6e-311e-7f88-7e3791caf88c', title: 'Grab a brush and put a little makeup.', completed: true },
  { id: '036af7f9-1181-fb8f-258f-3f06034c020f', title: 'Write a blog post.', completed: false },
  { id: '1cf63885-5f75-8deb-19dc-9b6765deae6c', title: 'Create a demo repository.', completed: false },
  { id: '63a871b2-0b6f-4427-9c35-304bc680a4b7', title: '??????', completed: false },
  { id: '63a871b2-0b6f-4422-9c35-304bc680a4b7', title: 'Profit.', completed: false },
]

app.use(cors())
app.use(bodyParser.json({ strict: false }))

// Disable 304 support, works wrong IMO
app.set('etag', false)
// Always send last-modified as current time
app.get('/*', function(req, res, next){ 
  res.setHeader('Last-Modified', (new Date()).toUTCString())
  next()
})

// Static files (disable etag)
app.use(express.static(`${__dirname}/dist`, { etag: false, index: false }))
app.use('/assets', express.static(`${__dirname}/dist/assets`, { etag: false }))
app.use('/css', express.static(`${__dirname}/dist/css`, { etag: false }))

// Obtain record
app.get('/api/todo/:id', function (req, res) {
  console.log('Getting record id = ' + req.params.id)
  dynamoDb.get({ TableName: tableName, Key: { id: req.params.id }}).promise().then((result) => {
      if (result.Item) {
        const { id, title, completed } = result.Item
        res.json({ id, title, completed })
      } else {
        res.status(404).json({ error: 'Record not found id = ' + req.params.id })
      }
    }).catch(error => {
      console.error('Failed to get record id = ' + req.params.id, error)
      res.status(500).json({ error: 'Failed to get record id = ' + req.params.id })
    })
})

app.delete('/api/todo/:id', function (req, res) {
  console.log('Deleting ', req.params.id)
  dynamoDb.delete({ TableName: tableName, Key: { id: req.params.id }}).promise().then(() => {
      res.json({ deleted: req.params.id })
    }).catch(error => {
      console.error('Failed to delete', error)
      res.status(500).json({ error: 'Failed to delete: ' + JSON.stringify(error) })
    })
})

// Clear DynamodDB
function initDynamoDB(res, callback) {
  console.log('Initializing DynamoDB', tableName)
  dynamoDb.scan({ TableName: tableName }).promise().then(result => {
    // All promises to delete
    let del = []
    if (result.Items && result.Items.length > 0) {
      del = result.Items.map(it => dynamoDb.delete({ TableName: tableName, Key: { id: it.id }}).promise())
    }    

    // Wait for delete
    console.log('Deleting ' + del.length + ' records')
    Promise.all(del).then(() => {
      console.log('Deleted ' + del.length + ' records')
      // Wait for create
      console.log('Adding ' + initialTodos.length + ' records')
      const add = initialTodos.map(it => dynamoDb.put({ TableName: tableName, Item: it }).promise())
      Promise.all(add).then(() => {
        console.log('Added ' + initialTodos.length + ' records')
        if (res) res.json({ count: add.length })
        if (callback) callback()
      }).catch(console.error)
    }).catch(console.error)
  }).catch (error => {
    console.error('Failed to get records', error)
    if (res) res.status(500).json({ error: 'Failed to get records: ' + JSON.stringify(error) })
    if (callback) callback()
  })
}

// Clear DynamoDB
app.post('/api/init', function (req, res) {
  initDynamoDB(res)
})

// List all records
app.get('/api/todo', function (req, res) {
  console.time('todo-scan')
  dynamoDb.scan({ TableName: tableName }).promise().then(result => {
    if (result.Items && result.Items.length > 0) {
      const all = result.Items.map(item => {
        return { id, title, completed } = item 
      })
      res.json(all)
    } else {
      res.json([])
    }
    console.timeEnd('todo-scan')
  }).catch(error => {
    console.log('Failed to get records', error)
    res.status(500).json({ error: 'Failed to get records: ' + JSON.stringify(error) })
  })
})

// Add new record
app.post('/api/todo', async function (req, res) {
  console.log('Adding new todo', req.body)
  let { id, title, completed } = req.body
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'id must be a string: ' + JSON.stringify(req.body) })
    return
  } else
  if (typeof title !== 'string') {
    res.status(400).json({ error: 'title must be a string: ' + JSON.stringify(req.body) })
    return
  }

  completed = !!completed // convert to boolean

  const params = {
    TableName: tableName,
    Item: {
      id, title, completed
    },
  }

  if (title.startsWith('!')) {
    const msg = title.substring(1)
    if (eventQueueUrl == null) {
      console.log(`Looking for queue url: ${eventQueueName}`)
      await SQS.getQueueUrl({ QueueName: eventQueueName }).promise().then(result => { 
        eventQueueUrl = result.QueueUrl
        console.log(`Got todo event queue url: ${eventQueueUrl}`)
      }).catch(console.error)
    }

    console.log(`Sending message to ${eventQueueUrl}: ${msg}`)
    SQS.sendMessage({ QueueUrl: eventQueueUrl, MessageBody: msg }).promise().
      then(console.log).
      catch(console.error)
      res.json({ ok: 'ok' })
  } else {
    dynamoDb.put(params).promise().then(result => {
      res.json({ id, title, completed })
    }).catch(error => {
      console.log('Cant add record: ' + JSON.stringify(params.Item), error)
      res.status(500).json({ error: 'Cant add record: ' + JSON.stringify(params.Item) })
    })
  }
})

app.get('/api/queue', async (req, res) => {
  if (eventQueueUrl == null) {
    console.log(`Looking for queue url: ${eventQueueName}`)
    await SQS.getQueueUrl({ QueueName: eventQueueName }).promise().then(result => {
      eventQueueUrl = result.QueueUrl
      console.log(`Got todo event queue url: ${eventQueueUrl}`)
    }).catch(console.error)
  }

  SQS.receiveMessage({ QueueUrl: eventQueueUrl }).promise().then(result => {
    res.json(result)
  }).catch(console.error)
})

// Update existing record
app.post('/api/todo/:id', function (req, res) {
  let { id, title, completed } = req.body
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'id must be a string: ' + JSON.stringify(req.body) })
    return
  } else
  if (typeof title !== 'string') {
    res.status(400).json({ error: 'title must be a string: ' + JSON.stringify(req.body) })
    return
  } else
  if (id !== req.params.id) {
    res.status(400).json({ error: 'id in body must match id in url' })
  }

  completed = !!completed // convert to boolean

  const params = {
    TableName: tableName,
    Key: {
      id: req.params.id,
    },
    Item: {
      id, title, completed
    }
  }

  dynamoDb.put(params).promise().then(_ => {
    res.json({ id, title, completed })
  }).catch(error => {
    console.log('Failed to update record id = ' + req.params.id, error)
    res.status(500).json({ error: 'Failed to update record id = ' + req.params.id })
  })
})

// Catchall 404
app.post('/api/*', function (req, res) {
  res.status(404).json({ error: 'Not found' })
})

// Render HTML
app.get('/*', (req, res) => {
  const props = {}
  App.default(req.url, props).then((reactComponent) => {
    const result = ReactDOMServer.renderToString(reactComponent)
    const html = template.replace('{{thing}}', result).replace('{{props}}', JSON.stringify(props))
    res.send(html)
    res.end()
  }).catch(console.error)
})

// Do something when AWS lambda started
if (process.env.AWS_EXECUTION_ENV !== undefined) {
  // _HANDLER contains specific invocation handler for this NodeJS instance
  console.log('AWS Lambda started, handler:', process.env._HANDLER)
} else {
  // Do something when serverless offline started
  if (process.env.IS_OFFLINE === 'true') {
    console.log('Serverless offline started.')
  } else {
    app.listen(port, () => {
      console.log(`Listening on port: ${port}`)
    })
  }
}

process.on('beforeExit', (code) => {
  console.log("NodeJS exiting")
})

process.on('SIGINT', _ => {
  console.log("Caught interrupt signal")
  process.exit(1)
})

module.exports.serverless = serverless(app, {
  binary: headers => {
    let ct = headers['content-type']
    if (ct === undefined) {
      console.error('No content-type header: ' + JSON.stringify(headers))
      return false
    }
    // cut ; charset=UTF-8
    if (ct.indexOf(';') > 0) {
      ct = ct.substring(0, ct.indexOf(';'))
    }
    let binary = String(ct).match(/image\/.*/) ? true : false
    console.log('binary: ' + ct + ' -> binary: ' + binary)
    return binary
  },

  request: function(request, event, context) {
    const { method, url } = request
    request.__started = new Date().getTime()
    console.log(`--> ${method} ${url}`)
  },

  response: function(response, event, context) {
    const { statusCode, statusMessage } = response
    const { method, url } = response.req
    const now = new Date().getTime()
    const elapsed = now - response.req.__started
    console.log(`<-- ${statusCode} ${statusMessage} ${method} ${url} Δ ${elapsed}ms`)
  }
})

/**
 * Subscribed to SQS, returns event in the form of
 * {
 *  Records: [
 *    {
 *      messageId: 'fec4fd9f-1a09-4449-8e1a-6e379dca4d2b',
 *      receiptHandle: 'base64-encoded-something',
 *      body: 'dasdsa',
 *      attributes: {},
 *      messageAttributes: {},
 *      md5OfBody: '7c1cadb6887373dacb595c47166bfbd9',
 *      eventSource: 'aws:sqs',
 *      eventSourceARN: 'arn:aws:sqs:eu-west-1:666123456:todos-events',
 *      awsRegion: 'eu-west-1'
 *  ]
 * }
 */
module.exports.receiveEvent = handler = function (event, context, callback) {
  if (event && event.Records) {
    console.log(`Got ${event.Records.length} events`)
    event.Records.forEach(event => {
      console.log('Got event: ', JSON.stringify(event))
      if (event.body == 'reset') {
        initDynamoDB(null, _ => {
          callback(null, 'Processing complete')
        })
      } else {
        console.error('Unknown event: ' + event.body)
      }
    })
  }

  // If you successfully invoke callback, all sent message will be deleted automatically
  // WARNING: If you call it BEFORE all async code is done, it will be ignored
  callback(null, 'Event processing complete')
}