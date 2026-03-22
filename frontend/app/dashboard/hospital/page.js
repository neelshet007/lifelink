'use client';

import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Building2, AlertCircle, MapPin, CheckCircle, Users, Plus, UserSearch, History } from 'lucide-react';

export default function HospitalDashboard() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('requests');

  // All requests (active + completed)
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Match Assignment Modal
  const [matchesModal, setMatchesModal] = useState({ isOpen: false, requestId: null, bloodGroup: '', matches: [], loading: false });

  // Internal DB
  const [internalDonors, setInternalDonors] = useState([]);
  const [dbModal, setDbModal] = useState(false);
  const [newDonor, setNewDonor] = useState({
    name: '', age: '', bloodGroup: 'A+', contact: '', barcodeId: '', donationHistory: '', isAvailable: true
  });

  // Split requests into active pipeline vs history
  const activeRequests = useMemo(() => requests.filter(r => r.status === 'Pending' || r.status === 'Accepted'), [requests]);
  const historyRequests = useMemo(() => requests.filter(r => r.status === 'Fulfilled' || r.status === 'Closed'), [requests]);

  useEffect(() => {
    const userData = JSON.parse(localStorage.getItem('user'));
    setUser(userData);

    if (userData) {
      fetchRequests();
      fetchInternalDonors();

      const socket = io('http://localhost:5000');
      socket.emit('join', userData.id);

      socket.on('new-blood-request', (data) => {
        setNotifications(prev => [data, ...prev.filter(n => n.requestId !== data.requestId)]);
        fetchRequests();
      });

      socket.on('request-updated', ({ requestId, status }) => {
        // Refresh full list so completed moves to history automatically
        fetchRequests();
        if (status === 'Accepted') {
          setNotifications(prev => prev.filter(n => n.requestId !== requestId));
        }
      });

      return () => socket.disconnect();
    }
  }, []);

  const fetchRequests = async () => {
    try {
      const token = localStorage.getItem('token');
      // Fetch all requests including completed ones for history
      const res = await axios.get('http://localhost:5000/api/requests/incoming', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRequests(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchInternalDonors = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('http://localhost:5000/api/hospital/donors', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setInternalDonors(res.data);
    } catch (err) { console.error(err); }
  };

  const handleUpdateStatus = async (requestId, status) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`http://localhost:5000/api/requests/${requestId}/status`,
        { status },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchRequests();
      setNotifications(prev => prev.filter(n => n.requestId !== requestId));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update request');
    }
  };

  const openAssignModal = async (req) => {
    setMatchesModal({ isOpen: true, requestId: req._id, bloodGroup: req.bloodGroup, matches: [], loading: true });
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`http://localhost:5000/api/requests/${req._id}/matches`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMatchesModal(prev => ({ ...prev, matches: res.data, loading: false }));
    } catch (err) {
      alert('Failed to load matches');
      setMatchesModal({ isOpen: false, requestId: null, bloodGroup: '', matches: [], loading: false });
    }
  };

  const handleAssignDonor = async (donorId, type) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`http://localhost:5000/api/requests/${matchesModal.requestId}/assign`,
        { assignedDonorId: donorId, assignedDonorType: type },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMatchesModal({ isOpen: false, requestId: null, bloodGroup: '', matches: [], loading: false });
      await fetchRequests(); // this will move the request to history
      alert('✅ Donor assigned. Request moved to History.');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to assign donor');
    }
  };

  const handleAddDonor = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post('http://localhost:5000/api/hospital/donors', newDonor, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setInternalDonors(res.data);
      setDbModal(false);
      setNewDonor({ name: '', age: '', bloodGroup: 'A+', contact: '', barcodeId: '', donationHistory: '', isAvailable: true });
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add donor');
    }
  };

  if (!user) return null;

  const RequestTable = ({ data, showAction }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-sm">
            <th className="pb-3 px-4 font-medium">Requester</th>
            <th className="pb-3 px-4 font-medium">Blood Group</th>
            <th className="pb-3 px-4 font-medium">Urgency</th>
            <th className="pb-3 px-4 font-medium">Status</th>
            {showAction && <th className="pb-3 px-4 font-medium text-right">Action</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {data.map(req => (
            <tr key={req._id} className="hover:bg-white/5 transition-colors">
              <td className="py-4 px-4 text-white">
                {req.requester?.name}
                <br /><span className="text-xs text-gray-500">{new Date(req.createdAt).toLocaleDateString()}</span>
              </td>
              <td className="py-4 px-4">
                <span className="bg-brand-gray px-3 py-1 rounded-full border border-white/10 font-bold text-lifered-400 text-sm">{req.bloodGroup}</span>
              </td>
              <td className={`py-4 px-4 text-sm font-medium ${req.urgency === 'Critical' ? 'text-red-400' : 'text-orange-400'}`}>
                {req.urgency}
              </td>
              <td className="py-4 px-4">
                <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                  req.status === 'Fulfilled' || req.status === 'Closed'
                    ? 'bg-green-500/20 text-green-400'
                    : req.status === 'Accepted'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-orange-500/20 text-orange-400'
                }`}>
                  {req.status}
                </span>
              </td>
              {showAction && (
                <td className="py-4 px-4 text-right">
                  {req.status === 'Pending' ? (
                    <button onClick={() => handleUpdateStatus(req._id, 'Accepted')}
                      className="px-3 py-1.5 bg-brand-gray hover:bg-white/10 text-white text-xs rounded-lg border border-white/10">
                      Accept
                    </button>
                  ) : req.status === 'Accepted' ? (
                    <button onClick={() => openAssignModal(req)}
                      className="px-3 py-1.5 bg-lifered-600 hover:bg-lifered-500 text-white text-xs rounded-lg shadow-lg">
                      Assign Donor
                    </button>
                  ) : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && (
        <div className="text-center p-10 text-gray-500">No requests here.</div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-brand-gray/40 border border-white/5 rounded-2xl p-6 shadow-xl gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">{user.role} Dashboard</h1>
          <p className="text-gray-400">Manage emergency pipelines and your internal donor database.</p>
        </div>
        <div className="p-3 bg-lifered-500/10 rounded-xl border border-lifered-500/20 hidden md:block">
          <Building2 className="h-6 w-6 text-lifered-500" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-8">
        {[
          { key: 'requests', label: 'Active Pipeline', badge: activeRequests.length },
          { key: 'history', label: 'History', badge: historyRequests.length },
          { key: 'database', label: 'Internal Donors', icon: <Users className="h-4 w-4" /> }
        ].map(tab => (
          <button key={tab.key}
            className={`pb-4 text-sm font-semibold transition-colors flex items-center gap-2 relative ${activeTab === tab.key ? 'text-white border-b-2 border-lifered-500' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => setActiveTab(tab.key)}>
            {tab.icon || null}
            {tab.label}
            {tab.badge > 0 && (
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-bold ${tab.key === 'requests' ? 'bg-lifered-500 text-white' : 'bg-white/10 text-gray-300'}`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active Requests Tab */}
      {activeTab === 'requests' && (
        <div className="space-y-6 animate-fade-in">
          {/* Live Alerts */}
          {notifications.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                <AlertCircle className="h-5 w-5 text-lifered-500" /> Live Emergency Alerts
              </h2>
              {notifications.map((notif, i) => (
                <div key={i} className="glass border-lifered-500/30 p-4 rounded-xl flex justify-between items-center shadow-lg">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-lifered-500/20 rounded-lg shrink-0">
                      <AlertCircle className="h-6 w-6 text-lifered-500 animate-pulse" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{notif.message}</p>
                      <p className="text-sm text-lifered-400 mt-1 flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {Number(notif.distance).toFixed(1)} km • {notif.urgency} Urgency
                      </p>
                    </div>
                  </div>
                  <button onClick={() => handleUpdateStatus(notif.requestId, 'Accepted')}
                    className="px-5 py-2 bg-lifered-600 hover:bg-lifered-500 text-white rounded-lg font-medium text-sm transition-colors">
                    Claim Request
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="glass-dark border border-white/5 p-6 rounded-2xl">
            <h2 className="text-xl font-bold mb-6">Active Pipeline</h2>
            <RequestTable data={activeRequests} showAction={true} />
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="animate-fade-in">
          <div className="glass-dark border border-white/5 p-6 rounded-2xl">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <History className="h-5 w-5 text-green-400" /> Completed Requests
            </h2>
            <RequestTable data={historyRequests} showAction={false} />
          </div>
        </div>
      )}

      {/* Database Tab */}
      {activeTab === 'database' && (
        <div className="animate-fade-in">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Your Saved Donors</h2>
            <button onClick={() => setDbModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-gray hover:bg-white/10 text-white rounded-xl text-sm font-medium border border-white/10">
              <Plus className="h-4 w-4" /> Add Donor
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {internalDonors.map(donor => (
              <div key={donor._id} className="glass-card p-5 rounded-2xl border border-white/5">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-bold text-white text-lg">{donor.name}</span>
                  <span className="bg-brand-dark px-2 py-1 rounded-full text-lifered-400 text-xs font-bold border border-white/5">{donor.bloodGroup}</span>
                </div>
                <div className="space-y-1 mt-2">
                  <p className="text-gray-400 text-xs">Age: <span className="text-white">{donor.age}</span></p>
                  <p className="text-gray-400 text-xs">Contact: <span className="text-white">{donor.contact}</span></p>
                  <p className="text-gray-400 text-xs">Barcode: <span className="text-blue-400 font-mono">{donor.barcodeId}</span></p>
                  {donor.donationHistory && <p className="text-gray-400 text-xs">History: {donor.donationHistory}</p>}
                </div>
                <div className="mt-4 pt-4 border-t border-white/5">
                  <span className="text-xs">{donor.isAvailable ? <span className="text-green-400">✓ Available</span> : <span className="text-red-400">✗ Unavailable</span>}</span>
                </div>
              </div>
            ))}
            {internalDonors.length === 0 && (
              <div className="col-span-3 text-center p-12 glass-dark rounded-2xl">
                <p className="text-gray-500">No internal donors yet. Click "Add Donor" to get started.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Donor Modal */}
      {dbModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-brand-dark border border-white/10 p-6 rounded-2xl w-full max-w-lg shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">Add Internal Donor</h3>
            <form onSubmit={handleAddDonor} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Full Name <span className="text-red-400">*</span></label>
                  <input required type="text" placeholder="e.g. John Doe"
                    className="w-full bg-brand-gray border border-white/10 rounded-xl p-3 text-white outline-none text-sm"
                    value={newDonor.name} onChange={(e) => setNewDonor({ ...newDonor, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Age <span className="text-red-400">*</span></label>
                  <input required type="number" min="18" max="65" placeholder="e.g. 28"
                    className="w-full bg-brand-gray border border-white/10 rounded-xl p-3 text-white outline-none text-sm"
                    value={newDonor.age} onChange={(e) => setNewDonor({ ...newDonor, age: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Blood Group <span className="text-red-400">*</span></label>
                  <select required className="w-full bg-brand-gray border border-white/10 rounded-xl p-3 text-white outline-none text-sm"
                    value={newDonor.bloodGroup} onChange={(e) => setNewDonor({ ...newDonor, bloodGroup: e.target.value })}>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Contact <span className="text-red-400">*</span></label>
                  <input required type="text" placeholder="Phone / Email"
                    className="w-full bg-brand-gray border border-white/10 rounded-xl p-3 text-white outline-none text-sm"
                    value={newDonor.contact} onChange={(e) => setNewDonor({ ...newDonor, contact: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Barcode / Donor ID <span className="text-red-400">*</span></label>
                <input required type="text" placeholder="e.g. DON-2026-00381"
                  className="w-full bg-brand-gray border border-white/10 rounded-xl p-3 text-white outline-none text-sm font-mono"
                  value={newDonor.barcodeId} onChange={(e) => setNewDonor({ ...newDonor, barcodeId: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Donation History <span className="text-gray-600 text-xs">(optional)</span></label>
                <input type="text" placeholder="e.g. 3 donations, last in Jan 2025"
                  className="w-full bg-brand-gray border border-white/10 rounded-xl p-3 text-white outline-none text-sm"
                  value={newDonor.donationHistory} onChange={(e) => setNewDonor({ ...newDonor, donationHistory: e.target.value })} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setDbModal(false)} className="flex-1 py-3 text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-lifered-600 hover:bg-lifered-500 text-white rounded-xl font-medium">Save Donor</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Donor Modal — NO extra input fields, all data from backend */}
      {matchesModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-brand-dark border border-lifered-500/20 p-6 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <UserSearch className="h-5 w-5 text-lifered-500" /> Select Donor
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Only compatible, available, eligible donors shown for <span className="text-lifered-400 font-bold">{matchesModal.bloodGroup}</span>
              </p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {matchesModal.loading ? (
                <div className="text-center py-8 text-gray-400 animate-pulse">Loading matched donors...</div>
              ) : matchesModal.matches.length === 0 ? (
                <div className="text-center py-8 text-orange-400">
                  No compatible + available + eligible donors found for this request.
                </div>
              ) : (
                matchesModal.matches.map((m, idx) => (
                  <div key={idx} className={`p-4 rounded-xl border flex justify-between items-center gap-4 ${m.type === 'Internal' ? 'bg-brand-gray/50 border-blue-500/20' : 'glass border-white/5'}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-white">{m.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${m.type === 'Internal' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                          {m.type}
                        </span>
                        <span className="text-xs bg-brand-dark px-2 rounded-full border border-white/10 text-lifered-400">{m.bloodGroup}</span>
                        {m.contact && <span className="text-xs text-gray-500">{m.contact}</span>}
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-gray-500">
                        <span>Priority Score: <span className="text-white font-semibold">{m.score.toFixed(1)}</span></span>
                        {m.barcodeId && <span>ID: <span className="text-blue-400 font-mono">{m.barcodeId}</span></span>}
                        {m.age && <span>Age: {m.age}</span>}
                      </div>
                    </div>
                    <button onClick={() => handleAssignDonor(m._id, m.type)}
                      className="px-5 py-2.5 bg-lifered-600 hover:bg-lifered-500 rounded-xl text-sm font-bold text-white transition-colors shrink-0">
                      Assign
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-white/5 text-right mt-4">
              <button onClick={() => setMatchesModal({ isOpen: false, requestId: null, bloodGroup: '', matches: [], loading: false })}
                className="px-6 py-2 text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
