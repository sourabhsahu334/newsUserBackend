import express from "express";
import bodyParser from "body-parser";

const app = express();
const PORT = 3000;

/**
 * Exotel sends data as application/x-www-form-urlencoded
 */
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/**
 * HEALTH CHECK
 */
app.get("/", (req, res) => {
    res.send("Exotel AI Call Server Running");
});

/**
 * EXOTEL PASSTHRU WEBHOOK
 * This URL is used in Flow Builder → Passthru
 */

app.all("/exotel/incoming", (req, res) => {
    console.log("📞 Incoming Call");

    console.log("Method:", req.method);
    console.log("Query:", req.query);
    console.log("Body:", req.body);

    // IMPORTANT: respond fast with 200 OK
    res.status(200).send("OK");
});


app.post("/exotel/incoming", async (req, res) => {
    console.log("📞 Incoming Call Data:", req.body);

    const caller = req.body.From || "Customer";

    /**
     * 🔴 IMPORTANT
     * Exotel expects XML response within ~3 seconds
     */
    const responseXML = `
<Response>
  <Say voice="female">
    Hello ${caller}.
    Welcome to our real estate support line.
    This is an automated assistant.
  </Say>

  <Pause length="1"/>

  <Say voice="female">
    Thank you for calling.
    Our executive will contact you shortly.
    Goodbye.
  </Say>

  <Hangup/>
</Response>
`;

    res.set("Content-Type", "text/xml");
    res.send(responseXML);
});

/**
 * START SERVER
 */
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
