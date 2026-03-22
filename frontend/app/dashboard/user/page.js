'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  Heart, 
  Droplet, 
  History, 
  MapPin, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Activity,
  PlusCircle,
  XCircle,
  Stethoscope
} from 'lucide-react';

export default function UserDashboard() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'requests', 'donations'
  const [myRequests, setMyRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Request Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({
    bloodGroup: '',
    urgency: 'Medium',
    latitude: '',
    longitude: ''
  });
  const [requestLoading, setRequestLoading] = useState(false);

  // Donation confirmation modal
  const [donationConfirm, setDonationConfirm] = useState({ isOpen: false, notification: null });

  // Stats
  const [stats, setStats] = useState({ requests: 0, donations: 0, matches: 0 });

  useEffect(() => {
    const userData = JSON.parse(localStorage.getItem('user'));
    setUser(userData);

    if (userData) {
      setRequestForm(prev => ({ ...prev, bloodGroup: userData.bloodGroup || 'A+' }));
      fetchUserData();
      const socket = io('http://localhost:5000');
      socket.emit('join', userData.id);

      socket.on('new-blood-request', (data) => {
        setNotifications(prev => [data, ...prev.filter(n => n.requestId !== data.requestId)]);
      });

      // Real-time: remove request from queue when claimed by anyone
      socket.on('request-updated', ({ requestId, status }) => {
        if (status === 'Accepted' || status === 'Completed') {
          setNotifications(prev => prev.filter(n => n.requestId !== requestId));
          fetchUserData();
        }
      });

      socket.on('request-accepted', (data) => {
        alert(data.message);
        fetchUserData();
      });

      socket.on('request-completed', (data) => {
        alert(data.message);
        fetchUserData();
      });

      return () => socket.disconnect();
    }
  }, []);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get('http://localhost:5000/api/requests/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMyRequests(res.data);
      setStats({
        requests: res.data.length,
        donations: 0,
        matches: res.data.filter(r => r.status === 'Completed').length
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setRequestForm(prev => ({
          ...prev,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        }));
      });
    }
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    if (!requestForm.latitude || !requestForm.longitude) {
      alert('Please detect your location for smart matching.');
      return;
    }
    setRequestLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post('http://localhost:5000/api/requests', requestForm, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setIsModalOpen(false);
      fetchUserData();
      alert('Blood request broadcasted successfully!');
    } catch (err) {
       alert(err.response?.data?.message || 'Failed to create request');
    } finally {
      setRequestLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-brand-gray/40 border border-white/10 rounded-3xl p-8 shadow-2xl gap-6">
        <div className="flex items-center gap-6">
          <div className="h-20 w-20 bg-lifered-600/20 rounded-2xl flex items-center justify-center border border-lifered-500/30">
            <Droplet className="h-10 w-10 text-lifered-500 fill-lifered-500/20" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">Welcome back, {user.name}</h1>
            <div className="flex items-center gap-3 text-gray-400">
              <span className="flex items-center gap-1.5 bg-brand-dark px-3 py-1 rounded-full text-xs font-semibold border border-white/5">
                <Activity className="h-3 w-3 text-green-400" /> Unified User
              </span>
              <span className="text-gray-600">•</span>
              <span className="text-sm font-medium">Ready to save lives today</span>
            </div>
          </div>
        </div>
        
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-6 py-3.5 bg-lifered-600 hover:bg-lifered-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-lifered-500/20 active:scale-95"
        >
          <PlusCircle className="h-5 w-5" />
          Quick Request Blood
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Total Requests', val: stats.requests, color: 'blue', icon: Droplet },
          { label: 'Lives Saved', val: stats.donations, color: 'green', icon: Heart },
          { label: 'Matches Found', val: stats.matches, color: 'purple', icon: CheckCircle2 }
        ].map((s, i) => (
          <div key={i} className="glass-dark border border-white/5 p-6 rounded-3xl shadow-xl flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm font-medium mb-1">{s.label}</p>
              <h3 className="text-3xl font-black text-white">{s.val}</h3>
            </div>
            <div className={`p-4 bg-${s.color}-500/10 rounded-2xl border border-${s.color}-500/20`}>
              <s.icon className={`h-8 w-8 text-${s.color}-500`} />
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-white/10 px-4">
        {['Overview', 'My Requests', 'Emergency Alerts'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab.toLowerCase().replace(' ', '-'))}
            className={`pb-4 text-sm font-bold transition-all relative ${
              (activeTab === tab.toLowerCase().replace(' ', '-')) 
              ? 'text-white' 
              : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
            {(activeTab === tab.toLowerCase().replace(' ', '-')) && (
               <div className="absolute bottom-0 left-0 w-full h-1 bg-lifered-500 rounded-full" />
            )}
            {tab === 'Emergency Alerts' && notifications.length > 0 && (
               <span className="ml-2 px-1.5 py-0.5 bg-lifered-500 text-white text-[10px] rounded-full animate-pulse">
                 {notifications.length}
               </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-8">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <section className="glass-dark p-8 rounded-3xl border border-white/5">
                <div className="flex justify-between items-center mb-6">
                   <h2 className="text-xl font-bold flex items-center gap-2">
                     <History className="h-5 w-5 text-lifered-400" /> Recent Activity
                   </h2>
                </div>
                {loading ? (
                   <div className="flex justify-center p-12"><Activity className="animate-spin text-lifered-500 h-8 w-8" /></div>
                ) : myRequests.length === 0 ? (
                   <div className="text-center py-12 text-gray-500 italic">No recent activity found.</div>
                ) : (
                  <div className="space-y-4">
                    {myRequests.slice(0, 3).map(req => (
                      <div key={req._id} className="flex items-center justify-between p-4 bg-brand-gray/30 rounded-2xl border border-white/5">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-brand-dark rounded-xl font-bold text-lifered-400 text-sm">
                             {req.bloodGroup}
                          </div>
                          <div>
                            <p className="text-white font-semibold flex items-center gap-2">
                              Blood Request {req.status === 'Completed' ? 'Fulfilled' : 'Active'}
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                req.status === 'Pending' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
                              }`}>
                                {req.status}
                              </span>
                            </p>
                            <p className="text-gray-500 text-xs mt-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {new Date(req.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        {req.status === 'Pending' && (
                           <div className="text-xs text-gray-400 flex items-center gap-1">
                             <Activity className="h-3 w-3 animate-pulse text-orange-500" /> System Matching...
                           </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-8">
              <div className="bg-gradient-to-br from-lifered-600 to-red-800 p-8 rounded-3xl shadow-2xl relative overflow-hidden group">
                 <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                    <Heart className="h-24 w-24" />
                 </div>
                 <h3 className="text-white text-2xl font-black mb-4 relative z-10">Donate & Save Lives</h3>
                 <p className="text-red-100 text-sm mb-6 relative z-10 opacity-80">Check the Emergency Alerts tab for nearby requests that need your blood type.</p>
                 <button className="w-full py-3 bg-white text-lifered-600 font-bold rounded-2xl relative z-10 shadow-lg hover:shadow-white/20 transition-all">
                    Enable Notifications
                 </button>
              </div>

              <div className="glass-dark p-6 rounded-3xl border border-white/5">
                 <h4 className="font-bold mb-4 flex items-center gap-2 text-white">
                    <MapPin className="h-4 w-4 text-lifered-400" /> Location Status
                 </h4>
                 <div className="flex items-center gap-3">
                    <div className="h-3 w-3 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
                    <span className="text-sm text-gray-300 font-medium">Global GPS Enabled</span>
                 </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'emergency-alerts' && (
          <div className="animate-fade-in space-y-6">
            <h2 className="text-2xl font-bold flex items-center gap-3">
               <AlertCircle className="h-6 w-6 text-lifered-500" /> Nearby Urgent Needs
            </h2>
            <div className="grid gap-6">
               {notifications.length > 0 ? notifications.map((notif, i) => (
                  <div key={i} className="glass p-6 rounded-3xl border border-lifered-500/30 flex justify-between items-center shadow-xl">
                      <div className="flex items-start gap-5">
                         <div className="p-3 bg-lifered-500/20 rounded-2xl">
                            <AlertCircle className="h-8 w-8 text-lifered-500 animate-pulse" />
                         </div>
                         <div>
                            <p className="text-lg font-bold text-white mb-2">{notif.message}</p>
                            <div className="flex items-center gap-4 text-sm text-gray-400">
                               <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-lifered-400" /> {notif.distance} km</span>
                               <span className="text-gray-700">|</span>
                               <span className="flex items-center gap-1.5"><Activity className="h-4 w-4 text-orange-400" /> {notif.urgency} Urgency</span>
                            </div>
                         </div>
                      </div>
                      <button 
                        onClick={() => setDonationConfirm({ isOpen: true, notification: notif })}
                        className="px-8 py-3.5 bg-white text-lifered-600 font-black rounded-2xl hover:bg-gray-100 transition-colors shadow-lg">
                         Help Now
                      </button>
                  </div>
               )) : (
                <div className="text-center py-20 bg-brand-gray/20 rounded-3xl border border-white/5">
                   <Heart className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                   <p className="text-gray-500 font-medium">No emergency alerts in your radius right now.</p>
                   <p className="text-gray-600 text-sm mt-1">We'll notify you the instant a match is found!</p>
                </div>
               )}
            </div>
          </div>
        )}

        {activeTab === 'my-requests' && (
           <div className="animate-fade-in space-y-6">
              <div className="flex justify-between items-center">
                 <h2 className="text-2xl font-bold">Your Active Requests</h2>
                 <button onClick={() => setIsModalOpen(true)} className="px-5 py-2.5 bg-lifered-600 hover:bg-lifered-500 border border-white/10 rounded-xl text-white text-sm font-bold transition-all flex items-center gap-2">
                    <PlusCircle className="h-4 w-4" /> New Request
                 </button>
              </div>
              <div className="grid gap-4">
                 {myRequests.map(req => (
                    <div key={req._id} className="glass-dark p-6 rounded-3xl border border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
                       <div className="flex items-center gap-6 w-full">
                          <div className="h-14 w-14 bg-brand-dark rounded-2xl flex items-center justify-center font-black text-lifered-400 border border-white/10">
                             {req.bloodGroup}
                          </div>
                          <div className="flex-1">
                             <div className="flex items-center gap-3 mb-1">
                                <h4 className="font-bold text-white text-lg">Blood Request</h4>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-tight ${
                                   req.status === 'Pending' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
                                }`}>
                                   {req.status}
                                </span>
                             </div>
                             <p className="text-gray-500 text-xs flex items-center gap-1.5">
                                <Clock className="h-3 w-3" /> Created on {new Date(req.createdAt).toLocaleDateString()}
                             </p>
                          </div>
                       </div>
                       
                       <div className="flex items-center gap-4 w-full md:w-auto">
                          {req.status === 'Pending' ? (
                            <div className="flex flex-col items-center md:items-end w-full">
                               <div className="w-full md:w-48 h-1.5 bg-brand-dark rounded-full overflow-hidden mb-2">
                                  <div className="h-full bg-lifered-500 animate-pulse-slow w-[75%]"></div>
                               </div>
                               <span className="text-[10px] text-gray-500 font-medium italic">Scanning Nearby Donors & Hospitals...</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 bg-green-500/10 px-4 py-2.5 rounded-2xl border border-green-500/20 w-full justify-center">
                               <CheckCircle2 className="h-5 w-5 text-green-400" />
                               <span className="text-green-400 font-bold text-sm">Request Fulfilled</span>
                            </div>
                          )}
                       </div>
                    </div>
                 ))}
                 {myRequests.length === 0 && (
                   <div className="text-center py-20 glass-dark rounded-3xl">
                      <Droplet className="h-10 w-10 text-gray-700 mx-auto mb-4" />
                      <p className="text-gray-600">You haven't made any requests yet.</p>
                   </div>
                 )}
              </div>
           </div>
        )}
      </div>

      {/* New Request Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
           <div className="bg-brand-dark border border-white/10 p-8 rounded-[2.5rem] w-full max-w-xl shadow-[0_0_100px_rgba(239,68,68,0.15)] relative overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-5">
                  <Droplet className="h-40 w-40 text-lifered-500" />
               </div>

               <div className="flex justify-between items-center mb-8 relative z-10">
                  <div className="flex items-center gap-3">
                     <div className="p-2 bg-lifered-500/10 rounded-xl">
                        <PlusCircle className="h-6 w-6 text-lifered-500" />
                     </div>
                     <h3 className="text-2xl font-black text-white">Broadcast Blood Request</h3>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-500 hover:text-white transition-colors">
                     <XCircle className="h-7 w-7" />
                  </button>
               </div>

               <form onSubmit={handleRequestSubmit} className="space-y-6 relative z-10">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-bold text-gray-400 mb-2 pl-1">Blood Group Needed</label>
                      <select 
                        className="w-full bg-brand-gray/50 border border-white/10 rounded-2xl p-4 text-white outline-none focus:ring-2 focus:ring-lifered-500 transition-all font-bold text-lg"
                        value={requestForm.bloodGroup} 
                        onChange={(e) => setRequestForm({...requestForm, bloodGroup: e.target.value})}
                        required
                      >
                         {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-400 mb-2 pl-1">Urgency Level</label>
                      <select 
                        className="w-full bg-brand-gray/50 border border-white/10 rounded-2xl p-4 text-white outline-none focus:ring-2 focus:ring-lifered-500 transition-all font-bold"
                        value={requestForm.urgency} 
                        onChange={(e) => setRequestForm({...requestForm, urgency: e.target.value})}
                        required
                      >
                         <option value="Low">Low (Standard)</option>
                         <option value="Medium">Medium (Urgent)</option>
                         <option value="High">High (Very Urgent)</option>
                         <option value="Critical">Critical (Immediate Help Required)</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-6 bg-brand-gray/30 rounded-3xl border border-white/5 space-y-4">
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-sm text-gray-300">
                           <MapPin className="h-4 w-4 text-lifered-400" />
                           {requestForm.latitude ? (
                              <span className="text-green-400 font-bold">Location Verified ✓</span>
                           ) : (
                              <span className="font-medium italic">Detect location for matching</span>
                           )}
                        </div>
                        <button 
                          type="button"
                          onClick={handleGetLocation}
                          className="px-4 py-2 bg-brand-dark hover:bg-white/5 border border-white/10 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
                        >
                           Detect Current Location
                        </button>
                     </div>
                  </div>

                  <div className="flex items-center gap-3 bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20">
                     <Stethoscope className="h-5 w-5 text-blue-400 shrink-0" />
                     <p className="text-[11px] text-blue-300 leading-tight">
                        Our smart algorithm will immediately notify all compatible donors and hospitals within 20km of your location. Please stay reachable.
                     </p>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button 
                      type="button" 
                      onClick={() => setIsModalOpen(false)} 
                      className="flex-1 py-4 text-gray-500 hover:text-white font-bold transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      disabled={requestLoading}
                      className="flex-2 py-4 bg-lifered-600 hover:bg-lifered-500 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-lifered-500/20 active:scale-95 flex items-center justify-center gap-2"
                    >
                      {requestLoading ? <Activity className="animate-spin h-5 w-5" /> : 'Broadcast Emergency'}
                    </button>
                  </div>
               </form>
           </div>
        </div>
      )}

      {/* Donation Confirmation Modal */}
      {donationConfirm.isOpen && donationConfirm.notification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
          <div className="bg-brand-dark border border-lifered-500/30 p-8 rounded-[2.5rem] w-full max-w-md shadow-2xl text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-lifered-600 to-red-400 opacity-50" />
            
            <div className="p-4 bg-lifered-500/10 rounded-full w-fit mx-auto mb-6">
              <Heart className="h-10 w-10 text-lifered-500" />
            </div>
            
            <h3 className="text-2xl font-black text-white mb-3">Confirm Your Donation</h3>
            <p className="text-gray-300 text-sm leading-relaxed mb-2">
              Are you sure you want to donate blood?
            </p>
            <p className="text-gray-500 text-xs leading-relaxed mb-8 px-4">
              This action may assign you to a patient in need and <strong className="text-orange-400">cannot be edited later</strong>. Please confirm carefully that you are currently available and eligible to donate.
            </p>

            <div className="p-4 bg-brand-gray/40 rounded-2xl border border-white/5 mb-8 text-left">
              <p className="text-lifered-400 font-semibold text-sm">{donationConfirm.notification.message}</p>
              <p className="text-gray-500 text-xs mt-1 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {donationConfirm.notification.distance} km away • {donationConfirm.notification.urgency} urgency
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setDonationConfirm({ isOpen: false, notification: null })}
                className="flex-1 py-3.5 border border-white/10 text-gray-400 hover:text-white rounded-2xl font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Mark user as responder; in a real flow this calls an API endpoint
                  alert('Thank you! You have been marked as a potential donor for this request. The hospital will contact you shortly.');
                  setDonationConfirm({ isOpen: false, notification: null });
                }}
                className="flex-1 py-3.5 bg-lifered-600 hover:bg-lifered-500 text-white rounded-2xl font-black transition-all shadow-lg shadow-lifered-500/20 active:scale-95"
              >
                Yes, I Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
