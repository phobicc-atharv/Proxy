# 🚀 Reverse Proxy System (Cybersecurity Hackathon Project)

## 📌 Overview
This project implements a **Reverse Proxy System** that acts as a protective layer between users and backend servers. It intercepts incoming requests, dynamically routes them to appropriate backend services, and provides a foundation for security and traffic control.

---

## 🎯 Objective
To build a custom reverse proxy system (without using tools like Nginx or HAProxy) that:
- Routes requests dynamically
- Controls traffic flow
- Enhances backend security

---

## 🧠 Key Features

### 🔁 Reverse Proxy
- Acts as an intermediary between client and backend
- Hides backend server from direct access

### 🔀 Dynamic Routing
- Routes requests based on URL paths
- Uses a configuration file (`config.json`)
- Easily scalable without changing code

### 🚦 Rate Limiting
- Limits number of requests per user
- Prevents server overload and brute-force attacks

### 🔐 Security Filtering (Planned)
- Detects malicious inputs (SQL injection, XSS)
- Blocks suspicious requests

---

## 🏗️ Project Structure
