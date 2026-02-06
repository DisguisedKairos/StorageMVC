const HelpMessage = require("../models/HelpMessage");
const AdminNotification = require("../models/AdminNotification");

function getUserId(req) {
  return req.session.user?.id || req.session.user?.user_id;
}

module.exports = {
  showHelp: (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    HelpMessage.listByUser(getUserId(req), (err, messages) => {
      if (err) return res.status(500).send("Database error");
      const helpIds = (messages || []).map((m) => m.help_id);
      HelpMessage.listRepliesByHelpIds(helpIds, (rErr, replies) => {
        if (rErr) return res.status(500).send("Database error");
        const replyMap = (replies || []).reduce((acc, r) => {
          acc[r.help_id] = acc[r.help_id] || [];
          acc[r.help_id].push(r);
          return acc;
        }, {});
        res.render("help", {
          user: req.session.user,
          messages: messages || [],
          replies: replyMap,
          error: null,
          success: null
        });
      });
    });
  },

  submitHelp: (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const subject = (req.body.subject || "").trim();
    const message = (req.body.message || "").trim();
    const attachmentPath = req.file ? `/uploads/help/${req.file.filename}` : null;

    if (!subject || !message) {
      return HelpMessage.listByUser(getUserId(req), (err, messages) => {
        if (err) return res.status(500).send("Database error");
        return res.render("help", {
          user: req.session.user,
          messages: messages || [],
          replies: {},
          error: "Please fill in subject and message.",
          success: null
        });
      });
    }

    HelpMessage.create({ userId: getUserId(req), subject, message, attachmentPath }, (err) => {
      if (err) return res.status(500).send("Database error");

      AdminNotification.create({
        providerId: null,
        type: "HELP",
        message: `New help request: ${subject}`
      }, () => {
        HelpMessage.listByUser(getUserId(req), (listErr, messages) => {
          if (listErr) return res.status(500).send("Database error");
          const helpIds = (messages || []).map((m) => m.help_id);
          HelpMessage.listRepliesByHelpIds(helpIds, (rErr, replies) => {
            if (rErr) return res.status(500).send("Database error");
            const replyMap = (replies || []).reduce((acc, r) => {
              acc[r.help_id] = acc[r.help_id] || [];
              acc[r.help_id].push(r);
              return acc;
            }, {});
            return res.render("help", {
              user: req.session.user,
              messages: messages || [],
              replies: replyMap,
              error: null,
              success: "Message sent to admin. We'll reply soon."
            });
          });
        });
      });
    });
  },

  userReply: (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const helpId = parseInt(req.params.id, 10);
    const message = (req.body.message || "").trim();

    if (!message) return res.redirect("/help");

    HelpMessage.addReply({ helpId, senderRole: "customer", message }, (err) => {
      if (err) return res.status(500).send("Database error");
      HelpMessage.updateStatus({ id: helpId, status: "OPEN" }, () => {
        const io = req.app.get("io");
        if (io) {
          io.to(`help:${helpId}`).emit("help:new", {
            helpId,
            sender_role: "customer",
            sender_id: getUserId(req),
            message,
            created_at: new Date().toISOString()
          });
        }
        return res.redirect("/help");
      });
    });
  },

  adminInbox: (req, res) => {
    const status = (req.query.status || "").trim();
    const q = (req.query.q || "").trim().toLowerCase();

    HelpMessage.listAll((err, messages) => {
      if (err) return res.status(500).send("Database error");
      let filtered = messages || [];
      if (status) {
        filtered = filtered.filter((m) => String(m.status).toLowerCase() === status.toLowerCase());
      }
      if (q) {
        filtered = filtered.filter((m) =>
          [m.subject, m.message, m.name, m.email].some((v) => String(v || "").toLowerCase().includes(q))
        );
      }
      const helpIds = (filtered || []).map((m) => m.help_id);
      HelpMessage.listRepliesByHelpIds(helpIds, (rErr, replies) => {
        if (rErr) return res.status(500).send("Database error");
        const replyMap = (replies || []).reduce((acc, r) => {
          acc[r.help_id] = acc[r.help_id] || [];
          acc[r.help_id].push(r);
          return acc;
        }, {});
        res.render("admin_help", {
          user: req.session.user,
          messages: filtered,
          replies: replyMap,
          error: null,
          success: null,
          filters: { status, q }
        });
      });
    });
  },

  adminReply: (req, res) => {
    const id = parseInt(req.params.id, 10);
    const reply = (req.body.reply || "").trim();
    const status = (req.body.status || "ANSWERED").trim();
    const adminId = getUserId(req);

    if (!reply) {
      return HelpMessage.listAll((err, messages) => {
        if (err) return res.status(500).send("Database error");
        return res.render("admin_help", {
          user: req.session.user,
          messages: messages || [],
          error: "Reply cannot be empty.",
          success: null,
          filters: { status: "", q: "" }
        });
      });
    }

    HelpMessage.addReply({ helpId: id, senderRole: "admin", message: reply }, (rErr) => {
      if (rErr) return res.status(500).send("Database error");
      HelpMessage.reply({ id, adminId, reply, status }, (err) => {
      if (err) return res.status(500).send("Database error");
        const io = req.app.get("io");
        if (io) {
          io.to(`help:${id}`).emit("help:new", {
            helpId: id,
            sender_role: "admin",
            sender_id: adminId,
            message: reply,
            created_at: new Date().toISOString()
          });
        }
      HelpMessage.listAll((listErr, messages) => {
        if (listErr) return res.status(500).send("Database error");
        const helpIds = (messages || []).map((m) => m.help_id);
        HelpMessage.listRepliesByHelpIds(helpIds, (lrErr, replies) => {
          if (lrErr) return res.status(500).send("Database error");
          const replyMap = (replies || []).reduce((acc, r) => {
            acc[r.help_id] = acc[r.help_id] || [];
            acc[r.help_id].push(r);
            return acc;
          }, {});
        return res.render("admin_help", {
          user: req.session.user,
          messages: messages || [],
          replies: replyMap,
          error: null,
          success: "Reply sent.",
          filters: { status: "", q: "" }
        });
        });
      });
      });
    });
  }
  ,

  adminDelete: (req, res) => {
    const admin = req.session.user;
    const helpId = parseInt(req.params.id, 10);
    if (!admin || admin.role !== "admin") return res.status(403).send("Forbidden");
    if (Number.isNaN(helpId)) return res.status(400).send("Invalid help id");

    HelpMessage.remove(helpId, (err) => {
      if (err) return res.status(500).send("Database error");
      return res.redirect("/admin/help");
    });
  }
};
