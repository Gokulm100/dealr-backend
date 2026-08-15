import User from "../models/user.model.js";
import Report from "../models/report.model.js";

export const getUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("name email profilePic isActive isBlocked reportCounter createdAt lastLogin lastActiveAt")
      .sort({ createdAt: -1 });

    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const setUserActive = async (req, res) => {
  try {
    const { userId, isActive } = req.body;
    if (!userId || typeof isActive !== "boolean") {
      return res.status(400).json({ message: "userId and isActive (boolean) are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isActive = isActive;
    if (isActive) {
      user.isBlocked = false;
      user.reportCounter = 0;
    }
    await user.save();

    res.json({ message: "User updated successfully", user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getReports = async (req, res) => {
  try {
    const { status } = req.body;
    const filter = {};
    if (status) {
      filter.status = status;
    }

    const reports = await Report.find(filter)
      .populate("reporter", "name email profilePic")
      .populate("reportedUser", "name email profilePic isActive isBlocked reportCounter")
      .sort({ createdAt: -1 });

    res.json({ reports });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateReport = async (req, res) => {
  try {
    const { reportId, status, adminNote } = req.body;
    if (!reportId || !status) {
      return res.status(400).json({ message: "reportId and status are required" });
    }

    const validStatuses = ["pending", "resolved", "dismissed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    report.status = status;
    if (adminNote !== undefined) {
      report.adminNote = adminNote;
    }
    await report.save();

    const populated = await Report.findById(report._id)
      .populate("reporter", "name email profilePic")
      .populate("reportedUser", "name email profilePic isActive isBlocked reportCounter");

    res.json({ message: "Report updated successfully", report: populated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
