// Additions/Changes annotated with // NEW or // CHANGED comments

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router"; // Ensure react-router-dom
const API_URL = import.meta.env.VITE_API_URL || "http://13.201.123.132:5000";

interface User {
  id: string;
  username: string;
  name: string;
  email: string;
}

interface Assignment {
  userId: string;
  percentage?: number;
  startRange?: number;
  endRange?: number;
}

export default function AdminAssignWork() {
  const [users, setUsers] = useState<User[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [assignmentType, setAssignmentType] = useState<"percentage" | "range">("percentage");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [includeDuplicates, setIncludeDuplicates] = useState(false); // NEW
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) {
      navigate("/admin/login");
      return;
    }
    verifyAdminToken(token).then((ok) => {
      if (!ok) navigate("/admin/login");
      else fetchUsers();
    });
  }, [navigate]);

  const verifyAdminToken = async (token: string) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/verify`, { headers: { "X-Admin-Token": token } });
      return res.status !== 401;
    } catch {
      return false;
    }
  };

  const fetchUsers = async () => {
    const adminToken = localStorage.getItem("admin_token") || "";
    try {
      const response = await fetch(`${API_URL}/api/admin/users`, { headers: { "X-Admin-Token": adminToken } });
      if (response.status === 401) {
        navigate("/admin/login");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (response.ok) setUsers(data.users || []);
      else {
        setMessage(data.error || "Failed to fetch users");
        setUsers([]);
      }
    } catch (e) {
      console.error(e);
      setMessage("Failed to fetch users");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0]);
  };

  const addAssignment = () => {
    setAssignments((prev) => [...prev, { userId: "", percentage: 0, startRange: 1, endRange: 1 }]);
  };

  const updateAssignment = (index: number, field: keyof Assignment, value: any) => {
    setAssignments((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeAssignment = (index: number) => {
    setAssignments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setMessage("Please select a CSV file");
      return;
    }
    if (assignments.length === 0) {
      setMessage("Please add at least one assignment");
      return;
    }
    for (const a of assignments) {
      if (!a.userId) {
        setMessage("Please select a user for all assignments");
        return;
      }
      if (assignmentType === "percentage") {
        if (!a.percentage || a.percentage <= 0) {
          setMessage("Percentage must be greater than 0");
          return;
        }
      } else {
        if (!a.startRange || !a.endRange || a.startRange > a.endRange) {
          setMessage("Provide valid range values (start <= end)");
          return;
        }
      }
    }

    if (assignmentType === "percentage") {
      const totalPct = assignments.reduce((s, a) => s + (a.percentage || 0), 0);
      if (totalPct !== 100) {
        setMessage("Total percentage must equal 100%");
        return;
      }
    }

    setLoading(true);
    setMessage("");

    const payloadAssignments = assignments.map(a => ({
      userId: a.userId,
      percentage: a.percentage,
      startRange: a.startRange,
      endRange: a.endRange
    }));

    const formData = new FormData();
    formData.append("csv_file", file);
    formData.append("assignment_type", assignmentType);
    formData.append("assignments", JSON.stringify(payloadAssignments));
    formData.append("include_duplicates", includeDuplicates ? "true" : "false"); // NEW

    const adminToken = localStorage.getItem("admin_token") || "";

    try {
      const response = await fetch(`${API_URL}/api/admin/upload-assign`, {
        method: "POST",
        headers: { "X-Admin-Token": adminToken },
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        navigate("/admin/login");
        return;
      }
      if (response.ok) {
        setMessage(`✅ ${data.message || "Work assigned"}`);
        setTimeout(() => navigate("/admin/dashboard"), 1200);
      } else {
        setMessage(`❌ ${data.error || "Assignment failed"}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("❌ Failed to assign work");
    } finally {
      setLoading(false);
    }
  };

  const totalPercentage = assignments.reduce((sum, a) => sum + (a.percentage || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black p-6">
      <div className="max-w-4xl mx-auto">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">📤 Assign Work</h1>
            <p className="text-gray-400">Upload CSV and assign work to users</p>
          </div>
          <button
            onClick={() => navigate("/admin/dashboard")}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
          >
            ← Back to Dashboard
          </button>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.includes("❌") ? "bg-red-900/50 border border-red-700 text-red-200" : "bg-green-900/50 border border-green-700 text-green-200"}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* File */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <label className="block text-white font-semibold mb-4">1. Upload CSV File</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              required
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white"
            />
            {file && (
              <p className="mt-2 text-sm text-green-400">
                ✓ Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

            {/* Include duplicates option */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <label className="block text-white font-semibold mb-4">2. Options</label>
            <div className="flex flex-col gap-4">
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    value="percentage"
                    checked={assignmentType === "percentage"}
                    onChange={(e) => setAssignmentType(e.target.value as "percentage")}
                  />
                  Percentage-based
                </label>
                <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    value="range"
                    checked={assignmentType === "range"}
                    onChange={(e) => setAssignmentType(e.target.value as "range")}
                  />
                  Range-based
                </label>
              </div>
              <label className="flex items-center gap-3 text-gray-300">
                <input
                  type="checkbox"
                  checked={includeDuplicates}
                  onChange={(e) => setIncludeDuplicates(e.target.checked)}
                />
                Include duplicate links (do NOT filter out duplicates before assignment)
              </label>
            </div>
          </div>

          {/* Assignments */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <label className="text-white font-semibold">3. Assign to Users</label>
              <button
                type="button"
                onClick={addAssignment}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                + Add User
              </button>
            </div>

            {assignments.length === 0 ? (
              <p className="text-gray-400 text-center py-8">Click "+ Add User" to start assigning work</p>
            ) : (
              <div className="space-y-4">
                {assignments.map((a, idx) => (
                  <div key={idx} className="bg-gray-900/50 border border-gray-600 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">User</label>
                        <select
                          value={a.userId}
                          onChange={(e) => updateAssignment(idx, "userId", e.target.value)}
                          required
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                        >
                          <option value="">Select user...</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
                          ))}
                        </select>
                      </div>
                      {assignmentType === "percentage" ? (
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Percentage</label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={a.percentage || ""}
                            onChange={(e) => updateAssignment(idx, "percentage", parseInt(e.target.value) || 0)}
                            required
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                          />
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="block text-sm text-gray-400 mb-2">Start Range</label>
                            <input
                              type="number"
                              min={1}
                              value={a.startRange || ""}
                              onChange={(e) => updateAssignment(idx, "startRange", parseInt(e.target.value) || 1)}
                              required
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-400 mb-2">End Range</label>
                            <input
                              type="number"
                              min={1}
                              value={a.endRange || ""}
                              onChange={(e) => updateAssignment(idx, "endRange", parseInt(e.target.value) || 1)}
                              required
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                            />
                          </div>
                        </>
                      )}
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => removeAssignment(idx)}
                          className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {assignmentType === "percentage" && assignments.length > 0 && (
              <div className="mt-4 p-3 bg-gray-900/50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total Percentage:</span>
                  <span className={totalPercentage === 100 ? "text-green-400 font-semibold" : "text-yellow-400 font-semibold"}>
                    {totalPercentage}%
                    {totalPercentage !== 100 && " (Should be 100%)"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-semibold disabled:opacity-60"
          >
            {loading ? "Assigning..." : "Assign Work"}
          </button>
        </form>
      </div>
    </div>
  );
}