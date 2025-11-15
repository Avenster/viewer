import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [hasAssignedWork, setHasAssignedWork] = useState(false);
  const [assignedWorkInfo, setAssignedWorkInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    checkAuthAndWork();
  }, []);

  const checkAuthAndWork = async () => {
    const token = localStorage.getItem("auth_token");
    
    if (!token) {
      navigate("/login");
      return;
    }

    try {
      // Verify auth token
      const authResponse = await fetch(`${API_URL}/api/auth/verify`, {
        headers: { "X-Auth-Token": token }
      });

      if (!authResponse.ok) {
        localStorage.removeItem("auth_token");
        navigate("/login");
        return;
      }

      const authData = await authResponse.json();
      setUser(authData.user);

      // Check for assigned work
      const workResponse = await fetch(`${API_URL}/api/check-assigned-work`, {
        headers: { "X-Auth-Token": token }
      });

      const workData = await workResponse.json();
      
      if (workData.hasAssignedWork) {
        setHasAssignedWork(true);
        setAssignedWorkInfo(workData);
      }

    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartAssignedWork = () => {
    if (assignedWorkInfo?.session_token) {
      localStorage.setItem("review_token", assignedWorkInfo.session_token);
      navigate("/viewer");
    }
  };

  const handleUploadCSV = () => {
    navigate("/home");
  };

  const handleLogout = () => {
    const token = localStorage.getItem("auth_token");
    
    fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      headers: { "X-Auth-Token": token || "" }
    }).finally(() => {
      localStorage.removeItem("auth_token");
      navigate("/login");
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black">
      {/* Header */}
      <div className="bg-black/50 backdrop-blur-sm border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">PDF Reviewer</h1>
            <p className="text-gray-400 text-sm">Welcome back, {user?.name}!</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">
            What would you like to do?
          </h2>
          <p className="text-gray-400">Choose an option below to get started</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Option 1: Admin Assigned Work */}
          <div className={`bg-gradient-to-br ${hasAssignedWork ? 'from-green-900/30 to-green-800/30 border-green-500' : 'from-gray-800/50 to-gray-700/50 border-gray-600'} border-2 rounded-2xl p-8 hover:scale-105 transition-transform duration-300 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-500/20 to-transparent rounded-bl-full"></div>
            
            <div className="relative z-10">
              <div className="text-5xl mb-4">
                {hasAssignedWork ? "✅" : "📋"}
              </div>
              
              <h3 className="text-2xl font-bold text-white mb-3">
                Admin Assigned Work
              </h3>
              
              {hasAssignedWork ? (
                <>
                  <div className="bg-black/30 rounded-lg p-4 mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-300 text-sm">Total PDFs:</span>
                      <span className="text-white font-bold text-lg">{assignedWorkInfo.total_pdfs}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300 text-sm">Status:</span>
                      <span className="text-green-400 font-semibold">Ready to Review</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={handleStartAssignedWork}
                    className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                  >
                    Start Reviewing →
                  </button>
                </>
              ) : (
                <>
                  <p className="text-gray-400 mb-6">
                    No work has been assigned to you by the admin yet.
                  </p>
                  
                  <button
                    disabled
                    className="w-full px-6 py-3 bg-gray-700 text-gray-500 rounded-lg font-semibold cursor-not-allowed"
                  >
                    No Work Assigned
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Option 2: Upload Your Own CSV */}
          <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/30 border-2 border-blue-500 rounded-2xl p-8 hover:scale-105 transition-transform duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/20 to-transparent rounded-bl-full"></div>
            
            <div className="relative z-10">
              <div className="text-5xl mb-4">📤</div>
              
              <h3 className="text-2xl font-bold text-white mb-3">
                Upload Your Own CSV
              </h3>
              
              <p className="text-gray-400 mb-6">
                Upload a CSV file containing PDF links to start your own review session.
              </p>
              
              <div className="bg-black/30 rounded-lg p-4 mb-4">
                <ul className="text-sm text-gray-300 space-y-2">
                  <li>✓ Supports bulk PDF review</li>
                  <li>✓ Automatic duplicate detection</li>
                  <li>✓ Export results anytime</li>
                </ul>
              </div>
              
              <button
                onClick={handleUploadCSV}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
              >
                Upload CSV →
              </button>
            </div>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-12 bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
            <span className="text-2xl">💡</span>
            Quick Tips
          </h4>
          <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-300">
            <div>
              <strong className="text-white">Admin Work:</strong> Work assigned by admin is prioritized and appears first.
            </div>
            <div>
              <strong className="text-white">CSV Format:</strong> Your CSV must contain a 'link' or 'URL' column with PDF links.
            </div>
            <div>
              <strong className="text-white">Duplicates:</strong> System automatically detects and warns about duplicate files.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}