// auth controller
const passport = require("passport");
const User = require("../models/User");
const adminController = require('./adminController');
const crypto = require('crypto');
const bcrypt = require("bcrypt");
const { sendEmail } = require("../../emailService");
const logUserActivity = require('../utils/activityLogger');
const logFeatureUsage = require('../utils/featureLogger');

exports.googleCallback = async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id }) || await User.findOne({ googleEmail: profile.emails[0].value });

    if (user) {
      user.lastActive = Date.now();
      user.isOnline = true;
      await user.save();
      if (!user.googleId) {
        user.googleId = profile.id;
        user.profileImage = profile.photos[0]?.value || '/img/profileImage/Profile.jpeg';
        await user.save();
      }
      return done(null, user);
    }
    else {
      user = await User.findOne({ googleEmail: profile.emails[0].value });

      if (user && !user.googleId) {
        user.googleId = profile.id;
        user.profileImage = profile.photos[0]?.value || '/img/profileImage/Profile.jpeg';
        user.lastActive = Date.now();
        user.isOnline = true;
        await user.save();
        return done(null, user);
      }
      else {
        const newUser = new User({
          googleId: profile.id,
          googleEmail: profile.emails[0].value,
          profileImage: profile.photos[0]?.value || '/img/profileImage/Profile.jpeg',
          role: profile.emails[0].value === process.env.ADMIN_EMAIL ? "admin" : "user",
          lastActive: Date.now(),
          isOnline: true
        });

        user = await newUser.save();
        adminController.sendUnexpiredAnnouncementsToNewUser(newUser.googleEmail);
        return done(null, user);
      }
    }
  } catch (error) {
    console.error(error);
    return done(error, null);
  }
};

exports.loginPage = (req, res) => {
  res.render("log/login");
};

exports.login = async (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('Error during authentication:', err);
      return next(err);
    }

    if (!user) {
      req.flash('error', info.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      return res.redirect('/login');
    }

    req.logIn(user, async (err) => {
      if (err) {
        console.error('Login error:', err);
        return next(err);
      }

      user.lastLogin = Date.now();
      user.lastActive = Date.now();
      
      await user.save();
      await logUserActivity(req.user._id, 'เข้าสู่ระบบ');
      await logFeatureUsage('เข้าสู่ระบบ');

      return res.redirect(user.role === 'admin' ? '/adminPage' : '/space');
    });
  })(req, res, next);
};

exports.registerUser = async (req, res) => {
  const { username, password, confirmPassword, googleEmail } = req.body;
  const errors = [];

  if (password !== confirmPassword) errors.push("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
  if (await User.findOne({ username })) errors.push("ชื่อผู้ใช้นี้มีอยู่แล้ว");
  if (await User.findOne({ googleEmail })) errors.push("อีเมลนี้มีอยู่แล้ว");

  if (errors.length > 0) {
    req.flash("errors", errors);
    return res.redirect("/register");
  }

  try {
    const newUser = new User({
      username,
      googleEmail
    });

    await User.register(newUser, password);
    req.flash('success', 'ลงทะเบียนสำเร็จแล้ว');
    res.redirect('/login');
  } catch (err) {
    req.flash('errors', [err.message]);
    res.redirect('/register');
  }
};

exports.registerPage = (req, res) => {
  res.render("log/register", {
    errors: req.flash("errors"),
    username: req.flash("username"),
    googleEmail: req.flash("googleEmail"),
    password: req.flash("password"),
    confirmPassword: req.flash("confirmPassword"),
  });
};

exports.loginFailure = (req, res) => {
  res.send("Something went wrong...");
};

exports.logout = (req, res) => {
  const userId = req.user ? req.user._id : null;

  req.logout(async (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error logging out");
    }
    try {
      if (userId) { // Ensure userId is not null
        await User.findByIdAndUpdate(userId, { isOnline: false });
      }
      req.session.destroy((error) => {
        if (error) {
          console.error(error);
          return res.status(500).send("Error logging out");
        }
        res.redirect("/");
      });
    } catch (error) {
      console.error('Error updating isOnline status:', error);
      res.status(500).send("Internal Server Error");
    }
  });
};


// Reset password
exports.showForgotPassword = (req, res) => {
  const error = req.flash('error');
  const success = req.flash('success');
  res.render('./forgot_password/forgot-password', { error, success });
};

exports.resendOTP = async (req, res) => {
  const { email } = req.body;

  try {
    console.log('เริ่มกระบวนการส่ง OTP');

    const user = await User.findOne({ googleEmail: email });
    if (!user) {
      req.flash('error', 'ไม่พบอีเมลในระบบ');
      console.log('ไม่พบอีเมลในระบบ:', email);
      return res.redirect('/forgot-password');
    }

    console.log('พบผู้ใช้:', user.googleEmail);

    const otp = crypto.randomBytes(6).toString('hex');
    const salt = await bcrypt.genSalt(12);
    const hashedOtp = await bcrypt.hash(otp, salt);

    user.otp = hashedOtp;
    user.otpExpires = Date.now() + 300000; // OTP valid for 5 minutes
    await user.save();

    console.log('OTP ถูกบันทึกในฐานข้อมูล');

    const mailSent = await sendEmail(
      user.googleEmail,
      'รหัส OTP สำหรับรีเซ็ตรหัสผ่าน',
      `รหัส OTP ของคุณคือ ${otp}. รหัส OTP จะหมดอายุใน 5 นาที.`
    );

    if (!mailSent) {
      req.flash('error', 'ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่');
      console.log('ส่งอีเมล OTP ไม่สำเร็จ'); // Log เมื่อส่ง OTP ล้มเหลว
      return res.redirect('/forgot-password');
    }

    console.log(`ส่งรหัส OTP ไปยังอีเมล: ${user.googleEmail}`);

    if (!mailSent) {
      req.flash('error', 'ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่');
      console.log('ส่งอีเมลไม่สำเร็จ');
      return res.redirect('/forgot-password');
    }

    console.log('ผลการส่งอีเมล:', mailSent); // ตรวจสอบผลลัพธ์ที่ได้จากการส่งอีเมล

    req.session.email = email;
    console.log('Session email:', req.session.email);

    req.flash('success', 'ส่งรหัส OTP ไปยังอีเมลของคุณเรียบร้อยแล้ว');
    res.redirect('/verify-otp');
  } catch (err) {
    console.error('เกิดข้อผิดพลาด:', err);
    req.flash('error', 'เกิดข้อผิดพลาดกรุณาลองอีกครั้ง');
    res.redirect('/forgot-password');
  }
};

exports.showVerifyOTP = (req, res) => {
  const error = req.flash('error');
  const success = req.flash('success');
  const { username } = req.session;
  res.render('./forgot_password/verify-otp', { error, success, username, email: req.session.email });
};

exports.verifyOTP = async (req, res) => {
  const { otp } = req.body;
  const { email } = req.session;

  try {
    const user = await User.findOne({ googleEmail: email });

    if (!user || !user.otp) {
      req.flash('error', 'รหัส OTP ไม่ถูกต้อง');
      return res.redirect('/verify-otp');
    }

    if (user.otpExpires < Date.now()) {
      req.flash('error', 'รหัส OTP หมดอายุ');
      user.otp = undefined;
      user.otpExpires = undefined;
      await user.save();
      return res.redirect('/verify-otp');
    }

    const isOtpValid = await bcrypt.compare(otp, user.otp);

    if (!isOtpValid) {
      req.flash('error', 'รหัส OTP ไม่ถูกต้อง');
      return res.redirect('/verify-otp');
    }

    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    req.flash('success', 'รหัส OTP ถูกต้อง กรุณาตั้งรหัสผ่านใหม่');
    res.redirect('/reset-password');
  } catch (err) {
    console.error(err);
    req.flash('error', 'เกิดข้อผิดพลาดกรุณาลองอีกครั้ง');
    res.redirect('/verify-otp');
  }
};

exports.showResetPassword = (req, res) => {
  const { email } = req.session; // ดึงค่า email จาก session
  res.render('forgot_password/reset-password', { email }); // ส่ง email ไปที่ EJS
};

exports.resetPassword = async (req, res) => {
  const { newPassword } = req.body;
  const email = (req.session.email || '').trim().toLowerCase();

  try {
    const user = await User.findOne({ googleEmail: email });
    if (!user) {
      req.flash('error', 'ไม่พบผู้ใช้ที่ร้องขอการรีเซ็ตรหัสผ่าน');
      return res.redirect('/forgot-password');
    }

    if (!newPassword) {
      req.flash('error', 'กรุณากรอกรหัสผ่านใหม่');
      return res.redirect('/reset-password');
    }

    console.log('เริ่มกระบวนการรีเซ็ตรหัสผ่าน:', email);

    // ใช้ setPassword
    await user.setPassword(newPassword);
    await user.save();

    await logFeatureUsage('เปลี่ยนรหัสผ่าน');

    console.log('รีเซ็ตรหัสผ่านเสร็จสมบูรณ์:', email);

    req.session.email = null;
    req.flash('success', 'รีเซ็ตรหัสผ่านสำเร็จแล้ว กรุณาเข้าสู่ระบบใหม่');
    res.redirect('/login');
  } catch (err) {
    console.error('Error during password reset:', err);
    req.flash('error', 'เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน กรุณาลองอีกครั้ง');
    res.redirect('/reset-password');
  }
};