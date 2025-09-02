const { generateKeyPairSync } = require("crypto");
const { writeFileSync } = require("fs");

// Generate 2048-bit RSA key pair
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

writeFileSync("keys/private.pem", privateKey);
writeFileSync("keys/public.pem", publicKey);

console.log("RSA key pair generated");
