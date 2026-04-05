import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'

export default function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const copyKey = () => {
    navigator.clipboard.writeText(user?.api_key || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const PLAN_LIMITS = {
    free: 5000,
    premium: 50000,
    pro: 300000,
    unlimited: 1000000
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-blue-600">🗺️ VillageAPI</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              Hello, {user?.name}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm text-red-500 hover:text-red-700 font-medium"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-800">
            Welcome back, {user?.name}! 👋
          </h2>
          <p className="text-gray-500 mt-1">
            Manage your API keys and monitor usage
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Current Plan</p>
            <p className="text-2xl font-bold text-blue-600 capitalize">
              {user?.plan || 'free'}
            </p>
            <span className="text-xs text-gray-400">
              {PLAN_LIMITS[user?.plan]?.toLocaleString()} requests/day
            </span>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Daily Limit</p>
            <p className="text-2xl font-bold text-green-600">
              {PLAN_LIMITS[user?.plan]?.toLocaleString()}
            </p>
            <span className="text-xs text-gray-400">requests per day</span>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Account Status</p>
            <p className="text-2xl font-bold text-green-600 capitalize">
              {user?.status || 'Active'}
            </p>
            <span className="text-xs text-gray-400">API access enabled</span>
          </div>
        </div>

        {/* API Key Card */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 mb-8">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            🔑 Your API Key
          </h3>

          <div className="bg-gray-50 rounded-lg p-4 flex items-center justify-between mb-4">
            <code className="text-sm text-gray-700 break-all">
              {user?.api_key || 'ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            </code>
            <button
              onClick={copyKey}
              className="ml-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition whitespace-nowrap"
            >
              {copied ? '✅ Copied!' : 'Copy'}
            </button>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-yellow-800 text-sm">
              ⚠️ Add this key to all API requests as <code className="bg-yellow-100 px-1 rounded">X-API-Key</code> header
            </p>
          </div>
        </div>

        {/* How to use */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 mb-8">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            🚀 Quick Start
          </h3>
          <div className="space-y-3">
            <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
              <pre className="text-green-400 text-sm">{`# Get all states
curl -H "X-API-Key: ${user?.api_key}" \\
  http://localhost:3000/v1/states`}</pre>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
              <pre className="text-green-400 text-sm">{`# Search villages
curl -H "X-API-Key: ${user?.api_key}" \\
  "http://localhost:3000/v1/search?q=Mumbai"`}</pre>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
              <pre className="text-green-400 text-sm">{`# Autocomplete
curl -H "X-API-Key: ${user?.api_key}" \\
  "http://localhost:3000/v1/autocomplete?q=Mum"`}</pre>
            </div>
          </div>
        </div>

        {/* Plan upgrade */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white">
          <h3 className="text-lg font-semibold mb-2">🚀 Upgrade Your Plan</h3>
          <p className="text-blue-100 text-sm mb-4">
            Need more requests? Upgrade to Premium, Pro, or Unlimited.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { name: 'Premium', price: '$49/mo', requests: '50,000/day' },
              { name: 'Pro', price: '$199/mo', requests: '300,000/day' },
              { name: 'Unlimited', price: '$499/mo', requests: '1M/day' },
            ].map(plan => (
              <div key={plan.name} className="bg-white bg-opacity-10 rounded-lg p-3 text-center">
                <p className="font-semibold">{plan.name}</p>
                <p className="text-xl font-bold mt-1">{plan.price}</p>
                <p className="text-blue-200 text-xs mt-1">{plan.requests}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}