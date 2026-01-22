const express = require("express");
const router = express.Router();
const storage = require("../controllers/storageController");

router.get("/", storage.listStorage);

module.exports = router;
