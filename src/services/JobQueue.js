const mongoose = require('mongoose');
const moment = require('moment-timezone');

const JobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  stepId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignStep' },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  jobType: { type: String, enum: ['cron', 'timeout'], required: true },
  scheduleType: { type: String, enum: ['daily', 'weekly', 'monthly', 'fixed'], required: true },
  cronPattern: { type: String },
  executeAt: { type: Date },
  data: { type: mongoose.Schema.Types.Mixed },
  status: { type: String, enum: ['scheduled', 'executing', 'completed', 'failed', 'cancelled'], default: 'scheduled' },
  lastExecution: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { 
    type: Date, 
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }
});

JobSchema.index({ campaignId: 1, status: 1 });
JobSchema.index({ jobId: 1 }, { unique: true });
JobSchema.index({ executeAt: 1 });
JobSchema.index({ createdAt: 1 });
JobSchema.index({ expiresAt: 1 });
JobSchema.index({ jobType: 1, scheduleType: 1 });

const Job = mongoose.model('Job', JobSchema);

class JobQueue {
  constructor() {
    this.initialized = false;
  }

  async init() {
    try {
      console.log('🔄 Initializing Job Queue...');
      
      await Job.createIndexes();
      
      await this.cleanupExpiredJobs();
      
      this.initialized = true;
      console.log('✅ Job Queue initialized');
      
    } catch (error) {
      console.error('❌ Error initializing Job Queue:', error);
      throw error;
    }
  }

  async saveCronJob(jobData) {
    try {
      const existing = await Job.findOne({
        campaignId: jobData.campaignId,
        stepId: jobData.stepId,
        cronPattern: jobData.cronPattern,
        status: 'scheduled'
      });
      
      if (existing) {
        console.log(`⚠️ Duplicate cron job, updating: ${jobData.jobId}`);
        return await Job.findOneAndUpdate(
          { _id: existing._id },
          { 
            ...jobData,
            updatedAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          },
          { new: true }
        );
      }
      
      const job = await Job.create({
        ...jobData,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
      
      console.log(`💾 Saved cron job: ${jobData.jobId}`);
      return job;
      
    } catch (error) {
      console.error('❌ Error saving cron job:', error);
      throw error;
    }
  }

  async saveTimeoutJob(jobData) {
    try {
      const existing = await Job.findOne({
        campaignId: jobData.campaignId,
        stepId: jobData.stepId,
        contactId: jobData.contactId,
        executeAt: jobData.executeAt,
        status: 'scheduled'
      });
      
      if (existing) {
        console.log(`⚠️ Duplicate timeout job, updating: ${jobData.jobId}`);
        return await Job.findOneAndUpdate(
          { _id: existing._id },
          { 
            ...jobData,
            updatedAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          },
          { new: true }
        );
      }
      
      const job = await Job.create({
        ...jobData,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
      
      console.log(`💾 Saved timeout job: ${jobData.jobId}`);
      return job;
      
    } catch (error) {
      console.error('❌ Error saving timeout job:', error);
      throw error;
    }
  }

  async deleteJob(jobId) {
    try {
      const result = await Job.deleteOne({ jobId });
      if (result.deletedCount > 0) {
        console.log(`🗑️ Deleted job: ${jobId}`);
      }
      return result.deletedCount > 0;
    } catch (error) {
      console.error('❌ Error deleting job:', error);
      return false;
    }
  }

  async deleteCampaignJobs(campaignId) {
    try {
      const result = await Job.deleteMany({ campaignId });
      console.log(`🗑️ Deleted ${result.deletedCount} jobs for campaign: ${campaignId}`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error deleting campaign jobs:', error);
      return 0;
    }
  }

  async deleteStepJobs(stepId) {
    try {
      const result = await Job.deleteMany({ stepId });
      console.log(`🗑️ Deleted ${result.deletedCount} jobs for step: ${stepId}`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error deleting step jobs:', error);
      return 0;
    }
  }

  async getPendingJobs(campaignId) {
    try {
      const now = new Date();
      const jobs = await Job.find({ 
        campaignId,
        status: 'scheduled',
        expiresAt: { $gt: now },
        $or: [
          { executeAt: { $gt: now } },
          { cronPattern: { $exists: true } }
        ]
      }).sort({ executeAt: 1 });
      
      return jobs;
    } catch (error) {
      console.error('❌ Error getting pending jobs:', error);
      return [];
    }
  }

  async getAllCampaignJobs(campaignId) {
    try {
      const jobs = await Job.find({ 
        campaignId,
        expiresAt: { $gt: new Date() }
      }).sort({ executeAt: 1 });
      
      return jobs;
    } catch (error) {
      console.error('❌ Error getting campaign jobs:', error);
      return [];
    }
  }

  async markJobExecuted(jobId, success = true) {
    try {
      const job = await Job.findOneAndUpdate(
        { jobId },
        { 
          status: success ? 'completed' : 'failed',
          lastExecution: new Date(),
          updatedAt: new Date()
        },
        { new: true }
      );
      
      if (job) {
        console.log(`✅ Marked job ${jobId} as ${success ? 'completed' : 'failed'}`);
      }
      
      return job;
    } catch (error) {
      console.error('❌ Error marking job executed:', error);
      return null;
    }
  }

  async cleanupExpiredJobs() {
    try {
      const result = await Job.deleteMany({ 
        expiresAt: { $lt: new Date() }
      });
      
      console.log(`🧹 Cleaned ${result.deletedCount} expired jobs`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up expired jobs:', error);
      return 0;
    }
  }

  async cleanupOldCompletedJobs(days = 3) {
    try {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const result = await Job.deleteMany({ 
        status: { $in: ['completed', 'failed'] },
        updatedAt: { $lt: cutoffDate }
      });
      
      console.log(`🧹 Cleaned ${result.deletedCount} old completed jobs`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old completed jobs:', error);
      return 0;
    }
  }

  async getJobCounts() {
    try {
      const counts = {
        total: await Job.countDocuments(),
        scheduled: await Job.countDocuments({ status: 'scheduled' }),
        completed: await Job.countDocuments({ status: 'completed' }),
        failed: await Job.countDocuments({ status: 'failed' }),
        cron: await Job.countDocuments({ jobType: 'cron' }),
        timeout: await Job.countDocuments({ jobType: 'timeout' })
      };
      
      return counts;
    } catch (error) {
      console.error('❌ Error getting job counts:', error);
      return {};
    }
  }
}

module.exports = new JobQueue();