const Storage = require("../models/Storage");
const User = require("../models/User");
const Booking = require("../models/Booking");
const Report = require("../models/Report");
const Kyc = require("../models/Kyc");

module.exports = {
    // ===== DASHBOARD =====
    dashboard: (req, res) => {
        Storage.getAll((errS, storage) => {
            User.getAll((errU, users) => {
                Booking.getAll((errB, bookings) => {
                    Report.getOverview((errR, overview) => {
                        const totalStorage = storage ? storage.length : 0;
                        const totalUsers = users ? users.length : 0;
                        const totalBookings = bookings ? bookings.length : 0;
                        const totalRevenue = Number(overview?.total_revenue || 0);
                        const paidBookings = Number(overview?.paid_bookings || 0);

                        res.render("admin_dashboard", {
                            user: req.session.user,
                            storage: storage || [],
                            users: users || [],
                            bookings: bookings || [],
                            stats: {
                                totalStorage,
                                totalUsers,
                                totalBookings,
                                paidBookings,
                                totalRevenue
                            }
                        });
                    });
                });
            });
        });
    },

    // ===== REPORTS =====
    reports: (req, res) => {
        Report.getOverview((errO, overview) => {
            Report.getMonthlyRevenue((errM, monthly) => {
                Report.getRevenueByMethod((errR, byMethod) => {
                    Report.getTopStorage((errT, topStorage) => {
                        res.render("admin_reports", {
                            user: req.session.user,
                            overview: overview || {},
                            monthly: monthly || [],
                            byMethod: byMethod || [],
                            topStorage: topStorage || []
                        });
                    });
                });
            });
        });
    },

    // ===== MODERATION QUEUE =====
    moderationQueue: (req, res) => {
        Kyc.listAll((errK, kycRows) => {
            if (errK) return res.status(500).send("Database error");
            Storage.getAll((errS, storageRows) => {
                if (errS) return res.status(500).send("Database error");
                Booking.getAll((errB, bookingRows) => {
                    if (errB) return res.status(500).send("Database error");

                    const pendingKyc = (kycRows || []).filter((k) => k.status === "PENDING");
                    const storageReview = (storageRows || []).slice(0, 12);
                    const suspicious = (bookingRows || []).filter((b) => {
                        const refunded = Number(b.refunded_amount || 0);
                        const status = (b.refund_status || "").toUpperCase();
                        return refunded > 0 || (status && status !== "NONE");
                    });

                    res.render("admin_moderation", {
                        user: req.session.user,
                        pendingKyc,
                        storageReview,
                        suspicious: suspicious.slice(0, 12)
                    });
                });
            });
        });
    },
    // ===== STORAGE MANAGEMENT =====
    showStorageList: (req, res) => {
        Storage.getAll((err, storage) => {
            res.render("admin_view_storage", { user: req.session.user, storage });
        });
    },

    showAddForm: (req, res) => {
        res.render("admin_add_storage", { user: req.session.user });
    },

    addStorage: (req, res) => {
        Storage.create(req.body, () => {
            res.redirect("/admin/storage");
        });
    },

    showEditForm: (req, res) => {
        Storage.findById(req.params.id, (err, results) => {
            res.render("admin_edit_storage", { user: req.session.user, storage: results[0] });
        });
    },

    updateStorage: (req, res) => {
        Storage.update(req.params.id, req.body, () => {
            res.redirect("/admin/storage");
        });
    },

    deleteStorage: (req, res) => {
        Storage.remove(req.params.id, () => {
            res.redirect("/admin/storage");
        });
    },

    // ===== KYC MANAGEMENT =====
    showKycList: (req, res) => {
        Kyc.listAll((err, rows) => {
            if (err) return res.status(500).send("Database error");
            res.render("admin_kyc", { user: req.session.user, kyc: rows || [] });
        });
    },

    approveKyc: (req, res) => {
        const id = parseInt(req.params.id, 10);
        const adminId = req.session.user?.id || req.session.user?.user_id;
        Kyc.setStatus({ id, status: "APPROVED", adminId }, (err) => {
            if (err) return res.status(500).send("Database error");
            res.redirect("/admin/kyc");
        });
    },

    rejectKyc: (req, res) => {
        const id = parseInt(req.params.id, 10);
        const adminId = req.session.user?.id || req.session.user?.user_id;
        Kyc.setStatus({ id, status: "REJECTED", adminId }, (err) => {
            if (err) return res.status(500).send("Database error");
            res.redirect("/admin/kyc");
        });
    },

    // ===== USER MANAGEMENT =====
    showUserList: (req, res) => {   // ✅ Correct name
        User.getAll((err, users) => {
            res.render("admin_user_details", { user: req.session.user, users });
        });
    },

    showEditUserForm: (req, res) => {
        User.findById(req.params.id, (err, results) => {
            if (results && results.length > 0) {
                res.render("admin_edit_user", { user: req.session.user, editUser: results[0] });
            } else {
                res.redirect("/admin/users");
            }
        });
    },

    updateUser: (req, res) => {
        User.update(req.params.id, req.body, () => {
            res.redirect("/admin/users");
        });
    },

    deleteUser: (req, res) => {
        User.remove(req.params.id, () => {
            res.redirect("/admin/users");
        });
    },

    // ===== BOOKING MANAGEMENT =====
    showBookingList: (req, res) => {
        Booking.getAll((err, bookings) => {
            res.render("admin_bookings", { user: req.session.user, bookings });
        });
    },

    showEditBookingForm: (req, res) => {
        Booking.findById(req.params.id, (err, results) => {
            if (results && results.length > 0) {
                res.render("admin_edit_booking", { user: req.session.user, booking: results[0] });
            } else {
                res.redirect("/admin/bookings");
            }
        });
    },

    updateBooking: (req, res) => {
        Booking.update(req.params.id, req.body, () => {
            res.redirect("/admin/bookings");
        });
    },

    deleteBooking: (req, res) => {
        Booking.remove(req.params.id, () => {
            res.redirect("/admin/bookings");
        });
    },

    // ===== KYC MANAGEMENT =====
    showKycList: (req, res) => {
        Kyc.listAll((err, rows) => {
            if (err) return res.status(500).send("Database error");
            res.render("admin_kyc", { user: req.session.user, kyc: rows || [] });
        });
    },

    approveKyc: (req, res) => {
        const id = parseInt(req.params.id, 10);
        const adminId = req.session.user?.id || req.session.user?.user_id;
        Kyc.setStatus({ id, status: "APPROVED", adminId }, (err) => {
            if (err) return res.status(500).send("Database error");
            res.redirect("/admin/kyc");
        });
    },

    rejectKyc: (req, res) => {
        const id = parseInt(req.params.id, 10);
        const adminId = req.session.user?.id || req.session.user?.user_id;
        Kyc.setStatus({ id, status: "REJECTED", adminId }, (err) => {
            if (err) return res.status(500).send("Database error");
            res.redirect("/admin/kyc");
        });
    }
};
