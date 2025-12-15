require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");

const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const axios = require("axios");

const PORT = process.env.PORT;
const app = express();

app.use(
  bodyParser.json({
    limit: "50mb",
    verify: (req, _, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(passport.initialize());

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    (accessToken, refreshToken, profile, done) => {
      console.log("Access Token: ", accessToken);
      console.log("Refresh Token: ", refreshToken);
      console.log("Profile: ", profile);
      done(null, profile);
    }
  )
);

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.labels",
    ],
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect("/");
  }
);

app.get("/", (req, res) => {
  console.log("User: ", req.user);
});

app.post("/webhook/gmail", (req, res) => {
  console.log("Gmail Webhook Received");
  res.status(200).send("ok");

  console.log(req.body);

  const { message } = req.body;

  if (!message || !message.data) {
    console.log("No message data found");
    return;
  }

  // Decode the Base64 encoded message data
  const encodedMessage = message.data;
  const decodedMessage = JSON.parse(
    Buffer.from(encodedMessage, "base64").toString("utf-8")
  );
  console.log("Decoded Message: ", decodedMessage);

  const historyId = decodedMessage.historyId;
  if (!historyId) {
    console.log("No historyId in decoded message");
    return;
  }

  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    console.log("Missing ACCESS_TOKEN in env");
    return;
  }

  const authHeaders = { Authorization: `Bearer ${ACCESS_TOKEN}` };

  // Helper to decode base64url bodies
  const decodeBody = (data) => {
    if (!data) return "";
    const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
    try {
      return Buffer.from(padded, "base64").toString("utf-8");
    } catch {
      return "";
    }
  };

  const extractText = (payload) => {
    if (!payload) return "";
    const parts = payload.parts || [];
    const body = payload.body;
    if (body && body.data) return decodeBody(body.data);
    const texts = [];
    for (const part of parts) {
      if (part.mimeType && part.mimeType.startsWith("text/plain")) {
        const data = part.body?.data;
        if (data) texts.push(decodeBody(data));
      }
      if (part.parts) {
        const nested = extractText(part);
        if (nested) texts.push(nested);
      }
    }
    return texts.join("\n");
  };

  const fetchMessage = async (id) => {
    try {
      const resp = await axios.get(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
        { params: { format: "full" }, headers: authHeaders }
      );
      return resp.data;
    } catch (err) {
      console.log("Failed to fetch message", id, err.response?.status, err.message);
      return null;
    }
  };

  const fetchHistory = async () => {
    try {
      const resp = await axios.get(
        "https://gmail.googleapis.com/gmail/v1/users/me/history",
        {
          params: {
            startHistoryId: historyId,
            historyTypes: "messageAdded",
          },
          headers: authHeaders,
        }
      );
      return resp.data.history || [];
    } catch (err) {
      console.log("Failed to fetch history", err.response?.status, err.message);
      return [];
    }
  };

  (async () => {
    const history = await fetchHistory();
    for (const entry of history) {
      for (const added of entry.messagesAdded || []) {
        const msgId = added.message?.id;
        if (!msgId) continue;
        const msg = await fetchMessage(msgId);
        if (!msg) continue;
        const subject =
          (msg.payload?.headers || []).find(
            (h) => (h.name || "").toLowerCase() === "subject"
          )?.value || "";
        const bodyText = extractText(msg.payload) || msg.snippet || "";
        console.log("Fetched email:", { subject, body: bodyText, id: msgId });
      }
    }
  })();
});

app.get("/hello", (req, res) => {
  res.send("Hello World from the server");
});

app.post("/pubsub", (req, res) => {
  console.log("Pubsub received");
  console.log(req.body);
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log("Server is running on port", PORT);
});