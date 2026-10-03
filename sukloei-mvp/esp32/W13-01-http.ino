/*
  ซักเลย W13-01 ESP32 Controller
  Prototype transport: HTTPS polling to Render
  Machine output: isolated dry-contact relay / optocoupler only.

  IMPORTANT:
  - DO NOT connect ESP32 GPIO directly to the LG coin connector.
  - Use an isolated relay/optocoupler stage.
  - Default pulse is 50 ms for LG coin-drop setting 0 (ESD/Greenwald/Munzprufer).
  - Verify the exact harness and voltage on the real machine before final wiring.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* API_BASE = "https://sukloei-machine-mvp.onrender.com";
const char* DEVICE_API_KEY = "REPLACE_WITH_DEVICE_API_KEY";
const char* MACHINE_CODE = "W13-01";

const int RELAY_PIN = 26;
const int STATUS_LED = 2;

String lastCommandId = "";

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void pulseRelay(int pulseMs) {
  digitalWrite(RELAY_PIN, HIGH);
  delay(pulseMs);
  digitalWrite(RELAY_PIN, LOW);
}

bool postAck(const String& commandId, const String& status) {
  WiFiClientSecure client;
  client.setInsecure(); // prototype only; pin CA certificate for production
  HTTPClient http;

  String url = String(API_BASE) + "/api/device/" + MACHINE_CODE + "/ack";
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_API_KEY);

  StaticJsonDocument<256> doc;
  doc["command_id"] = commandId;
  doc["status"] = status;
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

void pollCommand() {
  WiFiClientSecure client;
  client.setInsecure(); // prototype only
  HTTPClient http;

  String url = String(API_BASE) + "/api/device/" + MACHINE_CODE + "/next-command";
  if (!http.begin(client, url)) return;
  http.addHeader("x-device-key", DEVICE_API_KEY);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, body)) return;
  if (doc["command"].isNull()) return;

  String commandId = doc["command"]["command_id"] | "";
  String action = doc["command"]["action"] | "";
  int pulseMs = doc["command"]["pulse_ms"] | 50;

  if (commandId.length() == 0 || commandId == lastCommandId) return;

  if (action == "START") {
    if (pulseMs < 40) pulseMs = 40;
    if (pulseMs > 150) pulseMs = 150;

    digitalWrite(STATUS_LED, HIGH);
    pulseRelay(pulseMs);
    lastCommandId = commandId;
    postAck(commandId, "STARTED");
    digitalWrite(STATUS_LED, LOW);
  }
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  Serial.begin(115200);
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  pollCommand();
  delay(1500);
}
