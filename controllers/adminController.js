const Storage = require("../models/Storage");
const User = require("../models/User");
const Booking = require("../models/Booking");

module.exports = {
    // ===== DASHBOARD =====
    dashboard: (req, res) => {
    Storage.getAll((err, storage) => {
        User.getAll((err, users) => {
            Booking.getAll((err, bookings) => {

                // --- RENTAL ANALYTICS ---
                let totalRevenue = 0;
                let completedBookings = 0;
                let revenueByCategory = {};

                bookings.forEach(b => {
                    if (b.status === 'Completed') {
                        completedBookings++;

                        const days =
                            Math.ceil(
                                (new Date(b.end_date) - new Date(b.start_date)) /
                                (1000 * 60 * 60 * 24)
                            );

                        const revenue = days * b.price_per_day * b.quantity;
                        totalRevenue += revenue;

                        if (!revenueByCategory[b.category]) {
                            revenueByCategory[b.category] = 0;
                        }
                        revenueByCategory[b.category] += revenue;
                    }
                });

                res.render("admin_dashboard", {
                    storage: storage || [],
                    users: users || [],
                    bookings: bookings || [],
                    stats: {
                        totalStorage: storage ? storage.length : 0,
                        totalUsers: users ? users.length : 0,
                        totalBookings: bookings ? bookings.length : 0,
                        completedBookings,
                        totalRevenue,
                        revenueByCategory
                    }
                });
            });
        });
    });
},
    // ===== STORAGE MANAGEMENT =====
    showStorageList: (req, res) => {
        Storage.getAll((err, storage) => {
            res.render("admin_view_storage", { storage });
        });
    },

    showAddForm: (req, res) => {
        res.render("admin_add_storage");
    },

    addStorage: (req, res) => {
        Storage.create(req.body, () => {
            res.redirect("/admin/storage");
        });
    },

    showEditForm: (req, res) => {
        Storage.findById(req.params.id, (err, results) => {
            res.render("admin_edit_storage", { storage: results[0] });
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

    // ===== USER MANAGEMENT =====
    showUserList: (req, res) => {   // ✅ Correct name
        User.getAll((err, users) => {
            res.render("admin_user_details", { users });
        });
    },

    showEditUserForm: (req, res) => {
        User.findById(req.params.id, (err, results) => {
            if (results && results.length > 0) {
                res.render("admin_edit_user", { user: results[0] });
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
            res.render("admin_bookings", { bookings });
        });
    },

    showEditBookingForm: (req, res) => {
        Booking.findById(req.params.id, (err, results) => {
            if (results && results.length > 0) {
                res.render("admin_edit_booking", { booking: results[0] });
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
    }
};
