const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminController");

router.get("/storage", admin.showStorageList);
router.get("/add", admin.showAddForm);
router.post("/add", admin.addStorage);
router.get("/edit/:id", admin.showEditForm);
router.post("/edit/:id", admin.updateStorage);
router.get("/delete/:id", admin.deleteStorage);

module.exports = router;
