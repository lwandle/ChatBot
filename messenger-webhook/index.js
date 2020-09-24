//Imports dependencies and set up http server
const express = require("express"),
  bodyParser = require("body-parser"),
  app = express().use(bodyParser.json());
const request = require("request");

//SOCKET IO
const socket = require("socket.io");
// Sets server port and logs message on success
const server = app.listen(process.env.PORT || 1337, () =>
  console.log("webhook is listening")
);
// Global variables
const io = socket.listen(server);
let customers;
let messageArray = [];
// Page Access Token
const PAGE_ACCESS_TOKEN =
  "EAAE5zuW1VnIBALqSpQfcJ6q3ZCE2iPs1UezpOwllZAJdttP8Oz5fFEhIEJsnXJwMjzTweVCJMs5hmc0nV2pQZCrU1iT0h51HcsGnJ28FY64HG7eaKheBi8dwKtNwbe1pswwYhneTDaIyrGnpCTmGmioAT84qqaCV7mVNZA8G2M2itZBVx1cwv";

// Listens for Agent message and replies to the customer
io.sockets.on("save-message", (data) => {
  sendToMessenger(data.id, data.message.text);
});

// DB connection and setup
const MongoClient = require("mongodb").MongoClient;
const uri =
  "mongodb+srv://lwandle:KSibHWAHHqvzKu94@cluster0.0hygr.mongodb.net/gotbot?retryWrites=true&w=majority";
const client = new MongoClient(uri, { useNewUrlParser: true });
client.connect((err) => {
  customers = client.db("gotbot").collection("customer");
});

// Creates the endpoint for our webhook
app.post("/webhook", (req, res) => {
  let body = req.body;
  // Checks this is an event from a page subscription\
  if (body.object === "page") {
    // Iterates over each entry - there may be multiple if batched
    body.entry.forEach(function (entry) {
      // Gets the message. entry.messaging is an array, but
      // will only ever contain one message, so we get index 0
      let webhook_event = entry.messaging[0];
      //Get the sender ID
      let sender_psid = webhook_event.sender.id;

      // Create a new converstion or if the customer already exists , appand the thread
      customers.countDocuments({ id: sender_psid }).then((count) => {
        if (count === 0) {
          getUserInfo(sender_psid, webhook_event);
        } else {
          addMessage(webhook_event, sender_psid);
        }
      });
    });

    // Returns a '200 OK' response to all requests
    res.status(200).send("EVENT_RECEIVED");
  } else {
    // Returns a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }
});

// Adds support for GET requests to our webhook
app.get("/webhook", (req, res) => {
  // Your verify token. Should be a random string.
  let VERIFY_TOKEN = "lwandlendulitoken";

  // Parse the query params
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  // Checks if a token and mode is in the query string of the request
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    // Responds with the challenge token from the request
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    // Responds with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
  }
});

// Retieve Customer Info using Graph API
function getUserInfo(sender_psid, message) {
  // Send the HTTP request to the Messenger Platform
  request(
    {
      uri: `https://graph.facebook.com/v8.0/${sender_psid}`,
      method: "GET",
      qs: {
        fields: "first_name,last_name,profile_pic",
        access_token: `${PAGE_ACCESS_TOKEN}`,
      },
    },
    (err, res, body) => {
      if (!err) {
        try {
          // Convert string from Web Server to Object Create a Document
          var obj = JSON.parse(res.body);
          message.first_name = obj.first_name;
          message.last_name = obj.last_name;
          message.profile_pic = obj.profile_pic;
          messageArray.push(message);
          let cust = {
            first_name: obj.first_name,
            last_name: obj.last_name,
            profile_pic: obj.profile_pic,
            id: obj.id,
            conversation: messageArray,
          };
          customers.insertOne(cust);
        } catch (e) {
          console.log(e);
        }
      } else {
        console.error("Unable to get profile:" + err);
      }
    }
  );
}

// SEND MESSAGE TO MESSENGER
function sendToMessenger(sender_psid, message) {
  // construct the message body
  let request_body = {
    recipient: {
      id: sender_psid,
    },
    message: message.text,
  };
  // Send the HTTP request to the Messenger Platform
  request(
    {
      uri: "https://graph.facebook.com/v8.0/me/messages",
      qs: { access_token: PAGE_ACCESS_TOKEN },
      method: "POST",
      json: request_body,
    },
    (err, res, body) => {
      if (!err) {
        console.log("message sent");
      } else {
        console.log("Unable to send message:" + err);
      }
    }
  );
}

// ADD a new message to Thread in the DB and enit to the front End using socket.IO
function addMessage(message, id) {
  customers.findOne({ id: id }).then((cust) => {
    message.first_name = cust.first_name;
    message.last_name = cust.last_name;
    message.profile_pic = cust.profile_pic;
    cust.conversation.unshift(message);
    customers.save(cust);
    io.emit("new message", message);
  });
}

// ROUTES
// Adds message to the read from the frontend
app.post("/chat/:id", (req, res) => {
  customers.findOne({ id: req.params.id }).then((cust) => {
    cust.conversation.unshift(req.body);
    customers.save(cust).then((msg) => res.json(msg));
  });
});

// Get all customer converations
app.get("/chats", (req, res) => {
  customers.find({}).toArray((err, Customers) => {
    if (err) {
      console.log(err);
      return res.status(500).send(err);
    } else {
      return res.json(Customers);
    }
  });
});

// fetch thread with customer Id/ Thead Id
app.get("/chat/:id", (req, res) => {
  customers
    .findOne({ id: req.params.id })
    .then((cust) => res.json(cust.conversation))
    .catch((err) => res.status(404).json({ nonbrandfound: "No chats found" }));
});
