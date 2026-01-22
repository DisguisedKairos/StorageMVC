const Storage = require("../models/Storage");

module.exports = {
  // Customer-facing browse page
  browse: (req, res) => {
    Storage.getAll((err, results) => {
      if (err) return res.status(500).send("Database error");
      // storage_list.ejs expects `storage`
      res.render("storage_list", { storage: results });
    });
  }
};
