const passport = require('passport'); // เพิ่มการ import passport
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User'); // ปรับเส้นทางให้ถูกต้อง

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
},
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id }) || await User.findOne({ googleEmail: profile.emails?.[0]?.value });
      if (user) {
        user.lastActive = Date.now();
        user.isOnline = true;

        if (!user.googleId) user.googleId = profile.id || new mongoose.Types.ObjectId().toString();
        if (!user.profileImage) user.profileImage = profile.photos?.[0]?.value || "/img/profileImage/Profile.jpeg";

        await user.save();
        return done(null, user);
      } else {
        const newUser = new User({
          googleId: profile.id || uuidv4(),
          googleEmail: profile.emails?.[0]?.value || "",
          profileImage: profile.photos?.[0]?.value || "/img/profileImage/Profile.jpeg",
          role: "user",
          lastActive: Date.now(),
          isOnline: true,
        });

        if (!newUser.googleEmail) {
          throw new Error("Email is required for user registration.");
        }

        await newUser.save();
        return done(null, newUser);
      }
    } catch (err) {
      console.error("Error in Google Strategy:", err);
      return done(err, null);
    }
  }
)
);

// ตั้งค่า LocalStrategy สำหรับการเข้าสู่ระบบ
passport.use(new LocalStrategy({ usernameField: 'googleEmail' }, User.authenticate()));


passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


module.exports = passport;