const express = require("express");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const authController = require("../controllers/authController");
const router = express.Router();

// Google OAuth 2.0 strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    authController.googleCallback
  )
);

// Serialize user into session
passport.serializeUser(function (user, done) {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Google OAuth authentication route
router.get("/auth/google", passport.authenticate("google", { scope: ["email", "profile"] }));
router.get("/google/callback", passport.authenticate("google", {
  failureRedirect: "/login-failure",
  successRedirect: "/space",
}));

// Login
router.get("/login", authController.loginPage);
router.post("/login", authController.login);

// Register
router.post("/user/register", authController.registerUser);
router.get("/register", authController.registerPage);

// Login failure
router.get("/login-failure", authController.loginFailure);

// Logout
router.get("/logout", authController.logout);
router.get('/forgot-password', authController.showForgotPassword);
router.post('/forgot-password', authController.resendOTP);

// Route for OTP verification
router.get('/verify-otp', authController.showVerifyOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);

// Routes for reset password
router.get('/reset-password', authController.showResetPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;