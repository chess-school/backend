const User = require('../models/User');
const Notification = require('../models/Notification');
const Request = require('../models/Request');

class CoachController {
    async assignStudent(req, res) {
        const { coachEmail, studentEmail } = req.body;

        try {
            const coach = await User.findOne({ email: coachEmail });
            if (!coach || !coach.roles.includes('coach')) {
                return res.status(400).json({ msg: 'Invalid coach' });
            }

            const student = await User.findOne({ email: studentEmail });
            if (!student || !student.roles.includes('student')) {
                return res.status(400).json({ msg: 'Invalid student' });
            }

            student.trainer = coach._id;
            student.trainerEmail = coach.email;
            await student.save();

            const studentExists = coach.students.find(s => s.toString() === student._id.toString());
            if (!studentExists) {
                coach.students.push(student._id);
                await coach.save();
            }

            res.json({ msg: 'Student assigned to coach successfully' });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    async getCoaches(req, res) {
        try {
          const coaches = await User.find({ roles: 'coach' }).select('-password');;
          
          if (!coaches || coaches.length === 0) {
            return res.status(404).json({ msg: 'No coaches found' });
          }
      
          res.status(200).json(coaches);
        } catch (error) {
          console.error('Ошибка при получении списка тренеров:', error);
          res.status(500).json({ msg: 'Server error' });
        }
      }

    async getStudents(req, res) {
        const { coachEmail } = req.query;

        if (!coachEmail) {
            return res.status(400).json({ msg: 'Coach email is required' });
        }

        try {
            const coach = await User.findOne({ email: coachEmail }).populate('students');
            if (!coach || !coach.roles.includes('coach')) {
                return res.status(404).json({ msg: 'Coach not found' });
            }

            res.json(coach.students);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    async removeStudent(req, res) {
        const { coachEmail, studentId } = req.query;
    
        if (!coachEmail || !studentId) {
            return res.status(400).json({ msg: 'Coach email and student ID are required' });
        }
    
        try {
            const coach = await User.findOne({ email: coachEmail }).populate('students');
            if (!coach || !coach.roles.includes('coach')) {
                return res.status(404).json({ msg: 'Coach not found' });
            }
    
            const student = await User.findById(studentId);
            if (!student) {
                return res.status(404).json({ msg: 'Student not found' });
            }
    
            if (student.trainer?.toString() !== coach._id.toString()) {
                return res.status(400).json({ msg: 'Student not assigned to this coach' });
            }
    
            student.trainer = null;
            student.trainerEmail = null;
            await student.save();
    
            coach.students = coach.students.filter(s => s._id.toString() !== studentId);
            await coach.save();
    
            return res.json({ msg: 'Student removed successfully' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ msg: 'Server error' });
        }
    }
    

    async getStudentById(req, res) {
        const { coachEmail, studentId } = req.query;

        if (!coachEmail || !studentId) {
            return res.status(400).json({ msg: 'Coach email and student ID are required' });
        }

        try {
            const coach = await User.findOne({ email: coachEmail });
            if (!coach || !coach.roles.includes('coach')) {
                return res.status(404).json({ msg: 'Coach not found' });
            }

            const student = await User.findById(studentId);
            if (!student || student.trainer.toString() !== coach._id.toString()) {
                return res.status(404).json({ msg: 'Student not assigned to this coach' });
            }

            res.json(student);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server error');
        }
    }

    async getRequests(req, res) {
        try {
          const coachId = req.user.id;
      
          const requests = await Request.find({ coach: coachId }).populate('student', 'firstName lastName email');
          res.status(200).json(requests);
        } catch (error) {
          console.error('Ошибка при получении заявок:', error);
          res.status(500).json({ msg: 'Ошибка сервера' });
        }
      }
    
      async createRequest(req, res) {
        console.log(req)
        try {
            const studentId = req.user.id;
            const { coachId } = req.body;
    
            console.log('studentId:', studentId);
            console.log('coachId:', coachId);
    
            const existingRequest = await Request.findOne({ student: studentId, coach: coachId, status: 'pending' });
            console.log('existingRequest:', existingRequest);
    
            if (existingRequest) {
                return res.status(400).json({ msg: 'Заявка уже отправлена' });
            }
    
            const newRequest = new Request({
                student: studentId,
                coach: coachId,
            });
    
            console.log('newRequest:', newRequest);
    
            await newRequest.save();
    
            const notification = new Notification({
                recipient: coachId,
                type: 'request',
                content: `Новая заявка от студента ${req.user.firstName} ${req.user.lastName}`,
                metadata: { requestId: newRequest._id },
            });
    
            console.log('notification:', notification);
    
            await notification.save();
    
            res.status(201).json({ msg: 'Заявка успешно отправлена' });
        } catch (error) {
            console.error('Ошибка при создании заявки:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }    

    async handleRequest(req, res) {
        try {
            const { request_id } = req.query; 
            const { status } = req.body; 
    
            if (!request_id) {
                return res.status(400).json({ msg: 'Не передан идентификатор заявки' });
            }
    
            if (!['approved', 'rejected'].includes(status)) {
                return res.status(400).json({ msg: 'Некорректный статус' });
            }
    
            const request = await Request.findById(request_id).populate('student coach');
            if (!request) {
                return res.status(404).json({ msg: 'Заявка не найдена' });
            }
    
            request.status = status;
            await request.save();
    
            if (status === 'approved') {
                const student = request.student;
                const coach = request.coach;
    
                if (!coach || !student) {
                    return res.status(400).json({ msg: 'Ошибка при получении данных тренера или ученика' });
                }
    
                const studentExists = coach.students.some(s => s.toString() === student._id.toString());
                if (!studentExists) {
                    student.trainer = coach._id;
                    student.trainerEmail = coach.email;
                    await student.save();
    
                    coach.students.push(student._id);
                    await coach.save();
                }
            }
    
            const notification = new Notification({
                recipient: request.student._id,
                type: 'statusUpdate',
                content: `Ваша заявка была ${status === 'approved' ? 'одобрена' : 'отклонена'}`,
                metadata: { requestId: request_id },
            });
            await notification.save();
    
            res.status(200).json({ msg: `Заявка ${status === 'approved' ? 'принята' : 'отклонена'}` });
        } catch (error) {
            console.error('Ошибка при обработке заявки:', error);
            res.status(500).json({ msg: 'Ошибка сервера' });
        }
    }
    
    
}

module.exports = new CoachController();
