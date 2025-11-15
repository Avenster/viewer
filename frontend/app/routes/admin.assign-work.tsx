import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

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
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [totalPDFs, setTotalPDFs] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const adminToken = localStorage.getItem("admin_token");

    try {
      const response = await fetch(`${API_URL}/api/admin/users`, {
        headers: { "X-Admin-Token": adminToken || "" }
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const addAssignment = () => {
    setAssignments([...assignments, { userId: "", percentage: 0, startRange: 1, endRange: 1 }]);
  };

  const updateAssignment = (index: number, field: keyof Assignment, value: any) => {
    const updated = [...assignments];
    updated[index] = { ...updated[index], [field]: value };
    setAssignments(updated);
  };

  const removeAssignment = (index: number) => {
    setAssignments(assignments.filter((_, i) => i !== index));
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

    // Validate assignments
    for (const assignment of assignments) {
      if (!assignment.userId) {
        setMessage("Please select a user for all assignments");
        return;
      }

      if (assignmentType === "percentage") {
        if (!assignment.percentage || assignment.percentage <= 0) {
          setMessage("Percentage must be greater than 0");
          return;
        }
      } else {
        if (!assignment.startRange || !assignment.endRange) {
          setMessage("Please provide valid range values");
          return;
        }
        if (assignment.startRange > assignment.endRange) {
          setMessage("Start range must be less than or equal to end range");
          return;
        }
      }
    }

    setLoading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("csv_file", file);
    formData.append("assignment_type", assignmentType);
    formData.append("assignments", JSON.stringify(assignments));

    const adminToken = localStorage.getItem("admin_token");

    try {
      const response = await fetch(`${API_URL}/api/admin/upload-assign`, {
        method: "POST",
        headers: { "X-Admin-Token": adminToken || "" },
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(`✅ ${data.message}`);
        setTimeout(() => navigate("/admin/dashboard"), 2000);
      } else {
        setMessage(`❌ ${data.error || "Assignment failed"}`);
      }
    } catch (error) {
      console.error("Assignment error:", error);
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
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
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
          {/* File Upload */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <label className="block text-white font-semibold mb-4">
              1. Upload CSV File
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              required
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
            />
            {file && (
              <p className="mt-2 text-sm text-green-400">
                ✓ Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* Assignment Type */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <label className="block text-white font-semibold mb-4">
              2. Assignment Type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="percentage"
                  checked={assignmentType === "percentage"}
                  onChange={(e) => setAssignmentType(e.target.value as "percentage")}
                  className="w-4 h-4"
                />
                <span className="text-gray-300">Percentage-based</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="range"
                  checked={assignmentType === "range"}
                  onChange={(e) => setAssignmentType(e.target.value as "range")}
                  className="w-4 h-4"
                />
                <span className="text-gray-300">Range-based</span>
              </label>
            </div>
          </div>

          {/* Assignments */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <label className="text-white font-semibold">
                3. Assign to Users
              </label>
              <button
                type="button"
                onClick={addAssignment}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                + Add User
              </button>
            </div>

            {assignments.length === 0 ? (
              <p className="text-gray-400 text-center py-8">
                Click "+ Add User" to start assigning work
              </p>
            ) : (
              <div className="space-y-4">
                {assignments.map((assignment, index) => (
                  <div key={index} className="bg-gray-900/50 border border-gray-600 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">User</label>
                        <select
                          value={assignment.userId}
                          onChange={(e) => updateAssignment(index, "userId", e.target.value)}
                          required
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                        >
                          <option value="">Select user...</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} (@{user.username})
                            </option>
                          ))}
                        </select>
                      </div>

                      {assignmentType === "percentage" ? (
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Percentage</label>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={assignment.percentage || ""}
                            onChange={(e) => updateAssignment(index, "percentage", parseInt(e.target.value) || 0)}
                            required
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                            placeholder="e.g., 50"
                          />
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="block text-sm text-gray-400 mb-2">Start Range</label>
                            <input
                              type="number"
                              min="1"
                              value={assignment.startRange || ""}
                              onChange={(e) => updateAssignment(index, "startRange", parseInt(e.target.value) || 1)}
                              required
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                              placeholder="e.g., 1"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-400 mb-2">End Range</label>
                            <input
                              type="number"
                              min="1"
                              value={assignment.endRange || ""}
                              onChange={(e) => updateAssignment(index, "endRange", parseInt(e.target.value) || 1)}
                              required
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                              placeholder="e.g., 100"
                            />
                          </div>
                        </>
                      )}

                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => removeAssignment(index)}
                          className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
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
                  <span className={`font-semibold ${totalPercentage === 100 ? "text-green-400" : "text-yellow-400"}`}>
                    {totalPercentage}% {totalPercentage !== 100 && "(Should be 100%)"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg font-semibold disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "Assigning..." : "Assign Work"}
          </button>
        </form>
      </div>
    </div>
  );
}