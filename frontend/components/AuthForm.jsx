'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { User, Mail, Lock, Heart, Shield, MapPin } from 'lucide-react';
import Link from 'next/link';

export default function AuthForm({ type }) {
  const isLogin = type === 'login';
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', role: 'User', bloodGroup: 'A+', latitude: '', longitude: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFormData({
            ...formData,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        () => setError("Please enable location services for smart matching.")
      );
    } else {
      setError("Geolocation is not supported by this browser.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const res = await axios.post(`http://localhost:5000${endpoint}`, formData);
      
      // Only store if we got a valid token
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify({
          id: res.data._id,
          name: res.data.name,
          email: res.data.email,
          role: res.data.role,
          bloodGroup: res.data.bloodGroup || ''
        }));

        // Redirect to correct dashboard based on role
        const rolePath = res.data.role.toLowerCase().replace(' ', '-');
        router.push(`/dashboard/${rolePath}`);
      } else {
        setError('Authentication failed — no token received.');
      }
      
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 glass-dark rounded-2xl border border-white/10 shadow-2xl relative z-10 mx-4">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white mb-2">{isLogin ? 'Welcome Back' : 'Join LifeLink'}</h2>
        <p className="text-gray-400 text-sm">
          {isLogin ? 'Sign in to access your dashboard and manage requests.' : 'Create an account to start saving lives today.'}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-red-200 text-sm text-center">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {!isLogin && (
          <div className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-gray-500" />
              </div>
              <input
                type="text" name="name" placeholder="Full Name or Organization Name" required
                className="w-full pl-10 pr-4 py-3 bg-brand-dark/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lifered-500 focus:border-transparent transition-all"
                onChange={handleChange}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <select name="role" onChange={handleChange} value={formData.role}
                  className="w-full appearance-none pl-4 pr-10 py-3 bg-brand-dark/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-lifered-500 transition-all">
                  <option value="User">User</option>
                  <option value="Hospital">Hospital</option>
                  <option value="Blood Bank">Blood Bank</option>
                  <option value="Admin">Admin</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                  <Shield className="h-4 w-4" />
                </div>
              </div>

              {(formData.role === 'User') && (
                <div className="relative">
                  <select name="bloodGroup" onChange={handleChange} value={formData.bloodGroup}
                    className="w-full appearance-none pl-4 pr-10 py-3 bg-brand-dark/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-lifered-500 transition-all">
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-lifered-500">
                    <Heart className="h-4 w-4" />
                  </div>
                </div>
              )}
            </div>

            <div className="relative flex items-center gap-2 w-full">
              <button type="button" onClick={getLocation}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-brand-gray/50 hover:bg-white/5 border border-white/10 rounded-xl text-white text-sm transition-colors">
                <MapPin className="h-4 w-4 text-gray-400" />
                {formData.latitude ? 'Location Captured ✓' : 'Detect Location (Required)'}
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Mail className="h-5 w-5 text-gray-500" />
          </div>
          <input
            type="email" name="email" placeholder="Email Address" required
            className="w-full pl-10 pr-4 py-3 bg-brand-dark/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lifered-500 transition-all"
            onChange={handleChange}
          />
        </div>

        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-gray-500" />
          </div>
          <input
            type="password" name="password" placeholder="Password" required
            className="w-full pl-10 pr-4 py-3 bg-brand-dark/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lifered-500 transition-all"
            onChange={handleChange}
          />
        </div>

        <button type="submit" disabled={loading || (!isLogin && !formData.latitude && formData.role !== 'Admin')}
          className="w-full py-3.5 bg-lifered-600 hover:bg-lifered-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-lifered-500/20 active:scale-95 disabled:opacity-50 flex justify-center items-center mt-6">
          {loading ? (
             <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
             </svg>
          ) : (isLogin ? 'Sign In' : 'Create Account')}
        </button>
      </form>

      <p className="mt-8 text-center text-gray-400 text-sm">
        {isLogin ? "Don't have an account? " : "Already have an account? "}
        <Link href={isLogin ? "/register" : "/login"} className="text-lifered-400 hover:text-lifered-300 font-medium transition-colors">
          {isLogin ? 'Sign up' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}
