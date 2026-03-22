# 🚀 LifeLink – Smart Blood Donor & Matching Platform

A full-stack health-tech platform that connects **donors, patients, hospitals, and blood banks** in real-time to enable faster and smarter blood matching.

---

## 🧠 Problem

Current blood donation systems face major issues:
- ❌ No real-time donor availability  
- ❌ No centralized coordination  
- ❌ No location-based matching  
- ❌ No donor eligibility tracking  

---

## 💡 Solution

LifeLink solves this by providing:
- ✅ Real-time donor matching  
- ✅ Location-based search using maps  
- ✅ Smart eligibility tracking  
- ✅ Instant emergency notifications  

---

## ⚙️ Tech Stack

### Frontend
- Next.js (JavaScript)
- Tailwind CSS

### Backend
- Node.js
- Express.js
- MongoDB

### Other Tools
- Socket.io (real-time communication)
- Google Maps API (distance calculation)
- JWT Authentication

---

## 👥 User Roles

- 🩸 Donor  
- 🧑‍⚕️ Patient  
- 🏥 Hospital  
- 🩸 Blood Bank  
- 👨‍💻 Admin (system monitoring only)

---

## 🔑 Features

### 🩸 Donor
- Register & manage profile  
- Set availability  
- View & accept requests  
- Track donation history  

---

### 🧑‍⚕️ Patient
- Create blood requests  
- View nearby donors/hospitals  
- Track request status  

---

### 🏥 Hospital
- Manage incoming requests  
- Find nearby donors  
- Approve & fulfill requests  

---

### 🩸 Blood Bank
- Manage blood inventory  
- Accept/reject requests  
- Notify availability  

---

### 👨‍💻 Admin
- Monitor users  
- View analytics  
- Manage system  

---

## 🧠 Smart Matching Algorithm

Instead of using basic AI APIs, LifeLink uses a **mathematical scoring system**:
Match Score =
(0.4 × Distance Score) +
(0.3 × Compatibility Score) +
(0.2 × Availability Score) +
(0.1 × Eligibility Score)



### Factors:
- 📍 Distance (Google Maps / Haversine)
- 🩸 Blood compatibility  
- 🟢 Availability  
- ⏱️ Donation eligibility  

---

## 🚨 Real-Time Notifications

- Built using **Socket.io**
- Instant alerts when a request is created  
- Only nearby users are notified  

Example:🚨 Urgent: A patient near you needs B+ blood. Please help!


---

## 📁 Project Structure

LifeLink/
├── frontend/ # Next.js App
└── backend/ # Express Server


---

## ⚙️ Setup Instructions

### 1️⃣ Clone the repository
```bash
git clone https://github.com/your-username/lifelink.git
cd lifelink

2️⃣ Setup Backend

cd backend
npm install

Create .env file:

PORT=5000
MONGO_URI=your_mongodb_uri
JWT_SECRET=your_secret

Run backend:
npm run dev

3️⃣ Setup Frontend
cd frontend
npm install
npm run dev

🌐 App URLs
Frontend → http://localhost:3000
Backend → http://localhost:5000

🔗 API Example
GET http://localhost:5000/api/match

🔥 Future Scope
Nationwide blood network
AI-based donor prediction
Emergency broadcast system
WhatsApp/SMS alerts
Mobile app integration

💀 Why This Project Stands Out
Real-time system
Mathematical matching (not basic AI)
Multi-role architecture
Scalable design
Real-world impact

👨‍💻 Author

Neel Shet


---

## 🔥 PRO TIP

Before uploading to GitHub:
- Replace `your-username`
- Add screenshots later 📸
- Add demo video link 🎥

---

If you want next level 😈  
I can:
- Add **badges + animations**
- Create **GitHub description**
- Or help you write **LinkedIn post to go viral**

Just tell me 👍