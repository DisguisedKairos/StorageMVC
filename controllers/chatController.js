const Chat = require("../models/Chat");
const HelpMessage = require("../models/HelpMessage");

function getUserId(req) {
  return req.session.user?.id || req.session.user?.user_id;
}

function requireRole(req, res, role) {
  if (!req.session.user) {
    res.redirect("/login");
    return true;
  }
  if (req.session.user.role !== role) {
    res.status(403).send("Not authorized");
    return true;
  }
  return false;
}

module.exports = {
  listChats: (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const userId = getUserId(req);
    if (req.session.user.role === "customer") {
      return Chat.ensureThreadsForCustomer(userId, () => {
        return Chat.listThreadsByCustomer(userId, (err, threads) => {
          if (err) return res.status(500).send("Database error");
          Chat.listBookingsForCustomer(userId, (bErr, bookings) => {
            if (bErr) return res.status(500).send("Database error");
            HelpMessage.listByUser(userId, (hErr, helpMessages) => {
              if (hErr) return res.status(500).send("Database error");
              return res.render("chats", {
                user: req.session.user,
                role: "customer",
                threads: threads || [],
                bookings: bookings || [],
                helpMessages: helpMessages || []
              });
            });
          });
        });
      });
    }

    if (req.session.user.role === "provider") {
      return Chat.ensureThreadsForProvider(userId, () => {
        return Chat.listThreadsByProvider(userId, (err, threads) => {
          if (err) return res.status(500).send("Database error");
          Chat.listBookingsForProvider(userId, (bErr, bookings) => {
            if (bErr) return res.status(500).send("Database error");
            HelpMessage.listByUser(userId, (hErr, helpMessages) => {
              if (hErr) return res.status(500).send("Database error");
              return res.render("chats", {
                user: req.session.user,
                role: "provider",
                threads: threads || [],
                bookings: bookings || [],
                helpMessages: helpMessages || []
              });
            });
          });
        });
      });
    }

    if (req.session.user.role === "admin") {
      return res.redirect("/admin/help");
    }

    return res.status(403).send("Not authorized");
  },
  customerChat: (req, res) => {
    const guard = requireRole(req, res, "customer");
    if (guard) return;

    const bookingId = parseInt(req.params.id, 10);
    const userId = getUserId(req);

    Chat.getContextByBooking(bookingId, (err, ctx) => {
      if (err) return res.status(500).send("Database error");
      if (!ctx || Number(ctx.customer_id) !== Number(userId)) {
        return res.status(404).send("Chat not found");
      }

      Chat.getOrCreateThread(bookingId, ctx.customer_id, ctx.provider_id, (tErr, chatId) => {
        if (tErr) return res.status(500).send("Database error");
        Chat.listMessages(chatId, (mErr, messages) => {
          if (mErr) return res.status(500).send("Database error");
          res.render("chat", {
            user: req.session.user,
            chatId,
            bookingId,
            role: "customer",
            context: ctx,
            messages: messages || []
          });
        });
      });
    });
  },

  providerChat: (req, res) => {
    const guard = requireRole(req, res, "provider");
    if (guard) return;

    const bookingId = parseInt(req.params.id, 10);
    const userId = getUserId(req);

    Chat.getContextByBooking(bookingId, (err, ctx) => {
      if (err) return res.status(500).send("Database error");
      if (!ctx || Number(ctx.provider_id) !== Number(userId)) {
        return res.status(404).send("Chat not found");
      }

      Chat.getOrCreateThread(bookingId, ctx.customer_id, ctx.provider_id, (tErr, chatId) => {
        if (tErr) return res.status(500).send("Database error");
        Chat.listMessages(chatId, (mErr, messages) => {
          if (mErr) return res.status(500).send("Database error");
          res.render("chat", {
            user: req.session.user,
            chatId,
            bookingId,
            role: "provider",
            context: ctx,
            messages: messages || []
          });
        });
      });
    });
  },

  customerSend: (req, res) => {
    const guard = requireRole(req, res, "customer");
    if (guard) return;

    const bookingId = parseInt(req.params.id, 10);
    const userId = getUserId(req);
    const message = (req.body.message || "").trim();
    if (!message) return res.redirect(`/chat/${bookingId}`);

    Chat.getContextByBooking(bookingId, (err, ctx) => {
      if (err) return res.status(500).send("Database error");
      if (!ctx || Number(ctx.customer_id) !== Number(userId)) {
        return res.status(404).send("Chat not found");
      }

      Chat.getOrCreateThread(bookingId, ctx.customer_id, ctx.provider_id, (tErr, chatId) => {
        if (tErr) return res.status(500).send("Database error");
        Chat.addMessage({ chatId, senderRole: "customer", senderId: userId, message }, (mErr) => {
          if (mErr) return res.status(500).send("Database error");
          return res.redirect(`/chat/${bookingId}`);
        });
      });
    });
  },

  providerSend: (req, res) => {
    const guard = requireRole(req, res, "provider");
    if (guard) return;

    const bookingId = parseInt(req.params.id, 10);
    const userId = getUserId(req);
    const message = (req.body.message || "").trim();
    if (!message) return res.redirect(`/provider/chat/${bookingId}`);

    Chat.getContextByBooking(bookingId, (err, ctx) => {
      if (err) return res.status(500).send("Database error");
      if (!ctx || Number(ctx.provider_id) !== Number(userId)) {
        return res.status(404).send("Chat not found");
      }

      Chat.getOrCreateThread(bookingId, ctx.customer_id, ctx.provider_id, (tErr, chatId) => {
        if (tErr) return res.status(500).send("Database error");
        Chat.addMessage({ chatId, senderRole: "provider", senderId: userId, message }, (mErr) => {
          if (mErr) return res.status(500).send("Database error");
          return res.redirect(`/provider/chat/${bookingId}`);
        });
      });
    });
  }
};
