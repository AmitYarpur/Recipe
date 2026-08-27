# הפעלת האפליקציה Recipe

האפליקציה מוכנה מבחינת קוד, אבל היא צריכה פרויקט Firebase משלה כדי לשמור
את המתכונים (בלי זה מסך "מתכון חדש" ייכשל בשמירה). זה חד-פעמי.

## 1. יצירת פרויקט Firebase

1. פתחו את [console.firebase.google.com](https://console.firebase.google.com) והתחברו עם חשבון Google.
2. "Add project" → שם, למשל `recipe-amit` → אפשר לכבות Google Analytics (לא נדרש) → Create project.
3. בתפריט הצד: **Build → Firestore Database → Create database** → מצב **Production mode** → בחרו region קרוב (למשל `europe-west1`) → Enable.

## 2. חיבור אפליקציית ווב לפרויקט

1. בעמוד הראשי של הפרויקט לחצו על סמל ה-`</>` ("Add app" → Web).
2. תנו לה כינוי (למשל `recipe-web`), **אין** צורך לסמן Firebase Hosting.
3. Firebase יציג אובייקט קונפיגורציה בסגנון:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
4. פתחו את `Recipe/db.js` והחליפו את כל ה-`REPLACE_ME` בערכים האלו.

## 3. פריסת חוקי האבטחה (Firestore rules)

הקובץ `Recipe/firestore.rules` כבר מוכן ומגדיר שכל אחד יכול לקרוא/להוסיף/למחוק
מתכונים (אין התחברות באפליקציה - זה "ספר מתכונים משפחתי" משותף), עם בדיקת
שדות בסיסית שמונעת שמירה של מסמכים פגומים.

הכי פשוט: בקונסולת Firebase → **Firestore Database → Rules**, מחקו את מה שיש
שם והדביקו את התוכן של `firestore.rules` → **Publish**.

לחלופין, דרך שורת הפקודה (אם מותקן Node.js):
```bash
npm install -g firebase-tools
firebase login
cd Recipe
firebase use --add        # בחרו את הפרויקט שיצרתם
firebase deploy --only firestore:rules
```

## 4. בדיקה מקומית

קבצי ה-JS באפליקציה טעונים כמודולי ES (`type="module"`), אז פתיחה ישירה של
`index.html` מהדיסק (`file://`) לא תעבוד - צריך שרת מקומי קטן:

```bash
cd Recipe
npx serve .
# או: python3 -m http.server 8080
```

ואז פתחו את הכתובת שיודפס בטלפון/בדפדפן.

## 5. פריסה לאינטרנט

הריפו הזה כבר מוגדר עם GitHub Pages (`.github/workflows/static.yml`) שפורס
את כל התיקייה בכל push ל-`main`. אחרי push, האפליקציה תהיה זמינה בכתובת
ה-Pages של הריפו בנתיב `/Recipe/`.

## הערת אבטחה

מכיוון שאין התחברות משתמשים, כל מי שמגיע לכתובת האפליקציה יכול להוסיף
ולמחוק מתכונים. זה תואם את הבחירה ל"ספר מתכונים משותף בלי חשבונות" - אם
בעתיד יהיה צורך להגביל גישה, אפשר להוסיף קוד גישה משותף (PIN) או
Firebase App Check.
